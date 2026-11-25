package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

//go:embed web
var web embed.FS

const stageCount = 6
const studentAgeSeconds = int((30 * 24 * time.Hour) / time.Second)

var roomCode = regexp.MustCompile(`^[A-F0-9]{8}$`)

type submission struct {
	Values []string  `json:"values"`
	Text   string    `json:"text,omitempty"`
	At     time.Time `json:"at"`
	Rating int       `json:"rating,omitempty"`
}

type participant struct {
	Name     string                  `json:"name"`
	Seat     int                     `json:"seat,omitempty"`
	Answers  [stageCount]*submission `json:"answers"`
	live     *liveFrame
	learning [stageCount]learningEvidence
}

type classroom struct {
	Code             string                  `json:"code"`
	Title            string                  `json:"title"`
	Created          time.Time               `json:"created"`
	Version          uint64                  `json:"version"`
	Reset            uint64                  `json:"reset,omitempty"`
	Open             [stageCount]bool        `json:"open"`
	People           map[string]*participant `json:"people"`
	roster           uint64
	learningRevision uint64
}

type server struct {
	mu       sync.Mutex
	dir      string
	secure   bool
	password [32]byte
	teachers map[string]time.Time
	rooms    map[string]*classroom
	active   string
	frames   uint64
	failures int
	retryAt  time.Time
}

func token(size int) string {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value)
}

func digest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func newServer(dir, password string, secure bool) (*server, error) {
	if password == "" {
		password = "2026"
	} else if password != "2026" && (len(password) < 16 || len(password) > 256) {
		return nil, errors.New("custom TEACHER_PASSWORD must be 16–256 bytes")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	app := &server{dir: dir, secure: secure, password: sha256.Sum256([]byte(password)), teachers: map[string]time.Time{}, rooms: map[string]*classroom{}}
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, file := range files {
		code := strings.TrimSuffix(file.Name(), ".json")
		if file.IsDir() || code == file.Name() || !roomCode.MatchString(code) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, file.Name()))
		if err != nil {
			return nil, err
		}
		var room classroom
		if err := json.Unmarshal(data, &room); err != nil || room.Code != code || room.People == nil {
			return nil, fmt.Errorf("invalid classroom file: %s", file.Name())
		}
		app.rooms[code] = &room
	}
	data, err := os.ReadFile(filepath.Join(dir, "active"))
	if errors.Is(err, os.ErrNotExist) {
		var newest *classroom
		for _, room := range app.rooms {
			if newest == nil || room.Created.After(newest.Created) {
				newest = room
			}
		}
		if newest != nil {
			app.active = newest.Code
		}
		if err := app.setActive(app.active); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		app.active = string(data)
		if app.active != "" && app.rooms[app.active] == nil {
			return nil, errors.New("active classroom file refers to a missing classroom")
		}
	}
	return app, nil
}

func (app *server) save(room *classroom) error {
	return app.replace(room.Code+".json", func(file *os.File) error { return json.NewEncoder(file).Encode(room) })
}

func (app *server) setActive(code string) error {
	if err := app.replace("active", func(file *os.File) error { _, err := io.WriteString(file, code); return err }); err != nil {
		return err
	}
	app.active = code
	return nil
}

func (app *server) replace(name string, write func(*os.File) error) error {
	file, err := os.CreateTemp(app.dir, ".room-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = write(file); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), filepath.Join(app.dir, name))
}

func jsonOut(res http.ResponseWriter, status int, value any) {
	res.Header().Set("Content-Type", "application/json; charset=utf-8")
	res.WriteHeader(status)
	_ = json.NewEncoder(res).Encode(value)
}

func reject(res http.ResponseWriter, status int, message string) {
	jsonOut(res, status, map[string]string{"error": message})
}

func decode(res http.ResponseWriter, req *http.Request, dest any) bool {
	contentType, _, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if contentType != "application/json" {
		reject(res, 415, "请求格式不正确。")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(res, req.Body, 8192))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil || dec.Decode(new(any)) != io.EOF {
		reject(res, 400, "请检查填写的内容。")
		return false
	}
	return true
}

func validText(value string, max int, multiline bool) bool {
	if value == "" || utf8.RuneCountInString(value) > max {
		return false
	}
	for _, char := range value {
		if (unicode.IsControl(char) || unicode.Is(unicode.Cf, char)) && !(multiline && (char == '\n' || char == '\r')) {
			return false
		}
	}
	return true
}

func (app *server) setCookie(res http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(res, &http.Cookie{Name: name, Value: value, Path: "/api", Secure: app.secure, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

func cookieKey(req *http.Request, name string) string {
	cookie, err := req.Cookie(name)
	if err != nil || len(cookie.Value) != 64 {
		return ""
	}
	return digest(cookie.Value)
}

func (app *server) login(res http.ResponseWriter, req *http.Request) {
	var input struct{ Password string }
	if !decode(res, req, &input) {
		return
	}
	now := time.Now()
	app.mu.Lock()
	defer app.mu.Unlock()
	if now.After(app.retryAt) {
		app.failures, app.retryAt = 0, now.Add(5*time.Minute)
	}
	if app.failures >= 8 {
		reject(res, 429, "尝试次数过多，请稍后重试。")
		return
	}
	provided := sha256.Sum256([]byte(input.Password))
	if subtle.ConstantTimeCompare(provided[:], app.password[:]) != 1 {
		app.failures++
		reject(res, 401, "教师口令不正确。")
		return
	}
	for key, expires := range app.teachers {
		if now.After(expires) {
			delete(app.teachers, key)
		}
	}
	if len(app.teachers) >= 32 {
		reject(res, 429, "教师会话已满，请退出其他会话后再登录。")
		return
	}
	delete(app.teachers, cookieKey(req, "lab_teacher"))
	value := token(32)
	app.teachers[digest(value)] = now.Add(12 * time.Hour)
	app.setCookie(res, "lab_teacher", value, 12*3600)
	jsonOut(res, 200, struct{}{})
}

type roomStatus struct {
	Code    string           `json:"code"`
	Title   string           `json:"title"`
	Version uint64           `json:"version"`
	Reset   uint64           `json:"reset"`
	Open    [stageCount]bool `json:"open"`
	Active  bool             `json:"active"`
}

func (app *server) status(room *classroom) roomStatus {
	status := roomStatus{room.Code, room.Title, room.Version, room.Reset, room.Open, room.Code == app.active}
	if !status.Active {
		status.Open = [stageCount]bool{}
	}
	return status
}

func (app *server) studentStatus(room *classroom, person *participant) any {
	var done [stageCount]bool
	var ratings [stageCount]int
	for idx, answer := range person.Answers {
		if currentAnswer(idx, answer) != nil {
			done[idx] = true
			ratings[idx] = answer.Rating
		}
	}
	return struct {
		roomStatus
		Name    string           `json:"name"`
		Done    [stageCount]bool `json:"done"`
		Ratings [stageCount]int  `json:"ratings"`
	}{app.status(room), person.Name, done, ratings}
}

func (app *server) teacherStatus(room *classroom) any {
	var counts [stageCount]int
	seats := make([]int, 0, len(room.People))
	complete := 0
	for _, person := range room.People {
		if person.Seat > 0 {
			seats = append(seats, person.Seat)
		}
		done := 0
		for idx, answer := range person.Answers {
			if (room.Code != app.active && answer != nil) || currentAnswer(idx, answer) != nil {
				counts[idx]++
				done++
			}
		}
		if done == stageCount {
			complete++
		}
	}
	sort.Ints(seats)
	return struct {
		roomStatus
		Enrolled int             `json:"enrolled"`
		Counts   [stageCount]int `json:"counts"`
		Complete int             `json:"complete"`
		Seats    []int           `json:"seats"`
		Current  string          `json:"current"`
	}{app.status(room), len(room.People), counts, complete, seats, app.active}
}

func (app *server) stored(res http.ResponseWriter, room *classroom, rollback func()) bool {
	room.Version++
	if err := app.save(room); err != nil {
		room.Version--
		rollback()
		log.Printf("save classroom: %v", err)
		reject(res, 500, "保存失败，请稍后再试。")
		return false
	}
	return true
}

func stageIndex(value string) int {
	if len(value) == 1 && value[0] >= '1' && value[0] <= '6' {
		return int(value[0] - '1')
	}
	return -1
}

func (app *server) student(res http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) == 2 && parts[1] == "current" {
		app.currentStudent(res, req)
		return
	}
	if len(parts) < 3 || !roomCode.MatchString(parts[1]) {
		reject(res, 404, "没有找到这个课堂，请检查课堂码。")
		return
	}
	room := app.rooms[parts[1]]
	if room == nil {
		reject(res, 404, "没有找到这个课堂，请检查课堂码。")
		return
	}
	if room.Code != app.active {
		reject(res, 410, "这堂课已结束。")
		return
	}
	person := room.People[cookieKey(req, "lab_student")]
	if person == nil {
		reject(res, 401, "请先加入课堂。")
		return
	}
	if req.Method == "POST" && room.Reset != 0 && req.Header.Get("X-Classroom-Reset") != strconv.FormatUint(room.Reset, 10) {
		reject(res, 409, "本堂课的学生数据已清除，请重新加入。")
		return
	}
	if len(parts) == 3 && parts[2] == "status" && req.Method == "GET" {
		if req.URL.Query().Get("since") == strconv.FormatUint(room.Version, 10) {
			res.WriteHeader(204)
		} else {
			jsonOut(res, 200, app.studentStatus(room, person))
		}
		return
	}
	if len(parts) == 3 && parts[2] == "live" && req.Method == "POST" {
		app.publishFrame(res, req, room, person)
		return
	}
	if len(parts) == 4 && parts[2] == "activity" {
		idx := stageIndex(parts[3])
		if idx >= 0 {
			if !room.Open[idx] {
				reject(res, 423, "活动暂未开放，请听老师安排。")
				return
			}
			if req.Method == "GET" {
				jsonOut(res, 200, map[string]any{"content": catalog[idx], "answer": currentAnswer(idx, person.Answers[idx])})
				return
			}
			if req.Method == "POST" {
				var input struct {
					Values []string
					Text   string
					Rating *int
				}
				if !decode(res, req, &input) {
					return
				}
				input.Text = strings.TrimSpace(input.Text)
				if message := validate(idx, input.Values, input.Text); message != "" {
					reject(res, 400, message)
					return
				}
				old := person.Answers[idx]
				rating := 0
				if input.Rating != nil {
					rating = *input.Rating
					if rating < 1 || rating > 5 {
						reject(res, 400, "请为这项活动选择 1 到 5 颗星。")
						return
					}
				} else if currentAnswer(idx, old) != nil {
					rating = old.Rating
				}
				person.Answers[idx] = &submission{Values: input.Values, Text: input.Text, At: time.Now().UTC(), Rating: rating}
				if app.stored(res, room, func() { person.Answers[idx] = old }) {
					room.recordLearning(person, idx, submittedEvidence(idx, input.Values))
					if person.live != nil && person.live.Stage == idx+1 {
						app.frames++
						person.live.Revision = app.frames
					}
					jsonOut(res, 200, app.studentStatus(room, person))
				}
				return
			}
		}
	}
	reject(res, 404, "找不到这个活动。")
}

func (app *server) currentStudent(res http.ResponseWriter, req *http.Request) {
	room := app.rooms[app.active]
	if room == nil {
		reject(res, 404, "等待老师开启课堂。")
		return
	}
	if req.Method != "POST" {
		reject(res, 405, "请打开学生端加入课堂。")
		return
	}
	var input struct{ Device string }
	if !decode(res, req, &input) {
		return
	}
	if raw, err := hex.DecodeString(input.Device); err != nil || len(raw) != 32 {
		reject(res, 400, "浏览器无法建立课堂会话。")
		return
	}
	key := digest(input.Device)
	if cookie := cookieKey(req, "lab_student"); cookie != "" && cookie != key {
		if person := room.People[cookie]; person != nil {
			jsonOut(res, 200, app.studentStatus(room, person))
			return
		}
	}
	if person := room.People[key]; person != nil {
		app.setCookie(res, "lab_student", input.Device, studentAgeSeconds)
		jsonOut(res, 200, app.studentStatus(room, person))
		return
	}
	lastSeat := 0
	for _, person := range room.People {
		lastSeat = max(lastSeat, person.Seat)
	}
	seat := lastSeat + 1
	person := &participant{Name: fmt.Sprintf("学生%02d", seat), Seat: seat}
	room.People[key] = person
	if app.stored(res, room, func() { delete(room.People, key) }) {
		app.setCookie(res, "lab_student", input.Device, studentAgeSeconds)
		jsonOut(res, 201, app.studentStatus(room, person))
	}
}

type result struct {
	Name     string    `json:"name"`
	Values   []string  `json:"values"`
	Text     string    `json:"text,omitempty"`
	At       time.Time `json:"at"`
	Activity string    `json:"activity,omitempty"`
	Rating   int       `json:"rating,omitempty"`
}

func results(room *classroom, idx int) []result {
	items := make([]result, 0)
	for _, person := range room.People {
		if answer := person.Answers[idx]; answer != nil {
			entry := result{Name: person.Name, Values: displayValues(idx, answer.Values), Text: answer.Text, At: answer.At, Activity: legacyActivity(idx, answer.Values), Rating: answer.Rating}
			items = append(items, entry)
		}
	}
	sort.Slice(items, func(left, right int) bool { return items[left].At.After(items[right].At) })
	return items
}

func csvCell(value string) string {
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") || strings.HasPrefix(value, "＝") || strings.HasPrefix(value, "＋") || strings.HasPrefix(value, "－") || strings.HasPrefix(value, "＠") {
		return "'" + value
	}
	if value != "" && strings.ContainsRune("=+-@", rune(value[0])) {
		return "'" + value
	}
	return value
}

func exportRoom(res http.ResponseWriter, room *classroom) {
	res.Header().Set("Content-Type", "text/csv; charset=utf-8")
	res.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="modulelab-%s.csv"`, room.Code))
	_, _ = io.WriteString(res, "\ufeff")
	writer := csv.NewWriter(res)
	writer.UseCRLF = true
	_ = writer.Write([]string{"昵称", "活动", "选择与操作", "课堂记录", "提交时间（北京时间）", "自评星数"})
	chinaTime := time.FixedZone("UTC+8", 8*3600)
	for idx := range stageCount {
		for _, item := range results(room, idx) {
			activity := item.Activity
			if activity == "" {
				activity = stageNames[idx]
			}
			rating := ""
			if item.Rating > 0 {
				rating = strconv.Itoa(item.Rating)
			}
			_ = writer.Write([]string{csvCell(item.Name), activity, csvCell(strings.Join(item.Values, "；")), csvCell(item.Text), item.At.In(chinaTime).Format("2006-01-02 15:04:05"), rating})
		}
	}
	writer.Flush()
}

func (app *server) clearStudents(res http.ResponseWriter, req *http.Request, room *classroom) {
	if room.Code != app.active {
		reject(res, 410, "这堂课已结束，历史记录不能清除。")
		return
	}
	var input struct{ Reset *uint64 }
	if !decode(res, req, &input) {
		return
	}
	if input.Reset == nil || *input.Reset != room.Reset {
		reject(res, 409, "课堂的学生数据已更新，请重新确认。")
		return
	}
	if len(room.People) > 0 {
		people := room.People
		room.People = make(map[string]*participant)
		room.Reset++
		if !app.stored(res, room, func() { room.People = people; room.Reset-- }) {
			return
		}
	}
	jsonOut(res, 200, app.teacherStatus(room))
}

func (app *server) teacher(res http.ResponseWriter, req *http.Request, parts []string) {
	key := cookieKey(req, "lab_teacher")
	if !app.teachers[key].After(time.Now()) {
		reject(res, 401, "请登录教师端。")
		return
	}
	if len(parts) == 2 && parts[1] == "logout" && req.Method == "POST" {
		var input struct{}
		if decode(res, req, &input) {
			delete(app.teachers, key)
			app.setCookie(res, "lab_teacher", "", -1)
			jsonOut(res, 200, struct{}{})
		}
		return
	}
	if len(parts) >= 2 && parts[1] == "rooms" {
		if len(parts) == 2 && req.Method == "GET" {
			rooms := make([]*classroom, 0, len(app.rooms))
			for _, room := range app.rooms {
				rooms = append(rooms, room)
			}
			sort.Slice(rooms, func(left, right int) bool { return rooms[left].Created.After(rooms[right].Created) })
			list := make([]roomStatus, 0, len(rooms))
			for _, room := range rooms {
				list = append(list, app.status(room))
			}
			jsonOut(res, 200, list)
			return
		}
		if len(parts) == 2 && req.Method == "POST" {
			var input struct{ Title, Replace string }
			if !decode(res, req, &input) {
				return
			}
			title := strings.TrimSpace(input.Title)
			if !validText(title, 32, false) {
				reject(res, 400, "请输入 1 至 32 字的课堂名称。")
				return
			}
			if len(app.rooms) >= 100 {
				reject(res, 409, "课堂数量已达上限，请联系部署管理员。")
				return
			}
			if input.Replace != app.active {
				jsonOut(res, 409, map[string]string{"error": "当前课堂已变更，请重新确认。", "active": app.active})
				return
			}
			var code string
			for code == "" || app.rooms[code] != nil {
				code = strings.ToUpper(token(4))
			}
			room := &classroom{Code: code, Title: title, Created: time.Now().UTC(), People: map[string]*participant{}}
			if !app.stored(res, room, func() {}) {
				return
			}
			if err := app.setActive(code); err != nil {
				_ = os.Remove(filepath.Join(app.dir, code+".json"))
				log.Printf("activate classroom: %v", err)
				reject(res, 500, "未能开启下一堂课，原课堂仍在上课。")
				return
			}
			app.rooms[code] = room
			jsonOut(res, 201, app.teacherStatus(room))
			return
		}
		if len(parts) >= 3 {
			room := app.rooms[parts[2]]
			if room == nil {
				reject(res, 404, "没有找到这个课堂。")
				return
			}
			if len(parts) == 3 && req.Method == "GET" {
				jsonOut(res, 200, app.teacherStatus(room))
				return
			}
			if len(parts) == 4 && parts[3] == "clear-students" && req.Method == "POST" {
				app.clearStudents(res, req, room)
				return
			}
			if len(parts) == 4 && req.Method == "GET" {
				if parts[3] == "live-seats" {
					app.liveSeats(res, req, room)
					return
				}
				if parts[3] == "live" {
					app.watchFrame(res, req, room)
					return
				}
				if parts[3] == "learning" {
					app.learningStats(res, req, room)
					return
				}
				if parts[3] == "export" {
					exportRoom(res, room)
					return
				}
				if parts[3] == "results" {
					idx := stageIndex(req.URL.Query().Get("stage"))
					if idx >= 0 {
						jsonOut(res, 200, results(room, idx))
						return
					}
				}
			}
			if len(parts) == 5 && parts[3] == "activity" && req.Method == "POST" {
				if room.Code != app.active {
					reject(res, 410, "这堂课已结束，记录仍可查看。")
					return
				}
				idx := stageIndex(parts[4])
				var input struct{ Open *bool }
				if idx < 0 {
					reject(res, 404, "找不到这个活动。")
					return
				}
				if !decode(res, req, &input) {
					return
				}
				if input.Open == nil {
					reject(res, 400, "缺少开放状态。")
					return
				}
				prior := room.Open[idx]
				room.Open[idx] = *input.Open
				if prior == *input.Open || app.stored(res, room, func() { room.Open[idx] = prior }) {
					if prior && !room.Open[idx] {
						for _, person := range room.People {
							if person.live != nil && person.live.Stage == idx+1 {
								person.live = nil
							}
						}
					}
					jsonOut(res, 200, app.teacherStatus(room))
				}
				return
			}
		}
	}
	reject(res, 404, "没有找到这个页面。")
}

func (app *server) api(res http.ResponseWriter, req *http.Request) {
	res.Header().Set("Cache-Control", "private, no-store, max-age=0")
	parts := strings.Split(strings.TrimPrefix(req.URL.Path, "/api/"), "/")
	if req.URL.Path == "/api/teacher/login" && req.Method == "POST" {
		app.login(res, req)
		return
	}
	if req.Method != "GET" && req.Method != "POST" {
		res.Header().Set("Allow", "GET, POST")
		reject(res, 405, "不支持这个请求。")
		return
	}
	if req.Method == "POST" {
		req.Body = http.MaxBytesReader(res, req.Body, 8192)
		data, err := io.ReadAll(req.Body)
		if err != nil {
			reject(res, 400, "请检查填写的内容。")
			return
		}
		req.Body = io.NopCloser(strings.NewReader(string(data)))
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	switch parts[0] {
	case "student":
		app.student(res, req, parts)
	case "teacher":
		app.teacher(res, req, parts)
	default:
		reject(res, 404, "没有找到这个页面。")
	}
}

func (app *server) handler() http.Handler {
	assets, _ := fs.Sub(web, "web")
	files := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(res http.ResponseWriter, req *http.Request) {
		res.Header().Set("X-Content-Type-Options", "nosniff")
		res.Header().Set("Referrer-Policy", "same-origin")
		res.Header().Set("X-Frame-Options", "DENY")
		res.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
		if strings.HasPrefix(req.URL.Path, "/api/") {
			app.api(res, req)
			return
		}
		if req.Method != "GET" && req.Method != "HEAD" {
			res.Header().Set("Allow", "GET, HEAD")
			http.Error(res, "Method not allowed", 405)
			return
		}
		switch req.URL.Path {
		case "/healthz":
			res.Header().Set("Cache-Control", "no-store")
			_, _ = io.WriteString(res, "ok\n")
		case "/teacher", "/teacher/", "/":
			res.Header().Set("Cache-Control", "no-cache")
			clone := req.Clone(req.Context())
			clone.URL.Path = "/"
			files.ServeHTTP(res, clone)
		case "/app.js", "/style.css", "/art.svg":
			res.Header().Set("Cache-Control", "public, max-age=3600")
			files.ServeHTTP(res, req)
		default:
			http.NotFound(res, req)
		}
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if parsed, err := strconv.Atoi(port); err != nil || parsed < 1 || parsed > 65535 {
		log.Fatal("invalid PORT")
	}
	dir := os.Getenv("DATA_DIR")
	if dir == "" {
		dir = "data"
	}
	secure := os.Getenv("COOKIE_SECURE") != "false"
	app, err := newServer(dir, os.Getenv("TEACHER_PASSWORD"), secure)
	if err != nil {
		log.Fatal(err)
	}
	bind := os.Getenv("HOST")
	service := &http.Server{
		Addr: bind + ":" + port, Handler: app.handler(), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 12 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}
	log.Printf("Module Lab listening on %s", service.Addr)
	log.Fatal(service.ListenAndServe())
}
