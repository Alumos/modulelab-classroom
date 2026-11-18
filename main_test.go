package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func exercise(t *testing.T, app *server, method, path string, input any, cookie *http.Cookie, expected int) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &body)
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	app.handler().ServeHTTP(rec, req)
	if rec.Code != expected {
		t.Fatalf("%s %s: HTTP %d, want %d: %s", method, path, rec.Code, expected, rec.Body.String())
	}
	if strings.HasPrefix(path, "/api/") && !strings.Contains(rec.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("cacheable response for %s", path)
	}
	return rec
}

func testAnswer(values []string, text string) any {
	return map[string]any{"values": values, "text": text}
}

func TestClassroomJourney(t *testing.T) {
	password := token(24)
	dataDir := t.TempDir()
	app, err := newServer(dataDir, password, true)
	if err != nil {
		t.Fatal(err)
	}
	teacherRooms := "/api/teacher/rooms"
	exercise(t, app, "GET", "/healthz", nil, nil, 200)
	exercise(t, app, "GET", "/teacher", nil, nil, 200)
	exercise(t, app, "GET", "/art.svg", nil, nil, 200)
	exercise(t, app, "GET", teacherRooms, nil, nil, 401)
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": password}, nil, 200).Result().Cookies()[0]
	if !teacher.HttpOnly || !teacher.Secure || teacher.SameSite != http.SameSiteLaxMode {
		t.Fatal("teacher session cookies must be protected")
	}
	create := func(title, replace string) roomStatus {
		t.Helper()
		var room roomStatus
		if err := json.Unmarshal(exercise(t, app, "POST", teacherRooms, map[string]string{"title": title, "replace": replace}, teacher, 201).Body.Bytes(), &room); err != nil {
			t.Fatal(err)
		}
		if !roomCode.MatchString(room.Code) || !room.Active || room.Open != [stageCount]bool{} {
			t.Fatal("new rooms start with all activities locked")
		}
		return room
	}
	device := map[string]string{"device": token(32)}
	exercise(t, app, "POST", "/api/student/current", device, nil, 404)
	room := create("六年级一班", "")
	studentRoom := "/api/student/" + room.Code
	teacherRoom := teacherRooms + "/" + room.Code
	join := exercise(t, app, "POST", "/api/student/current", device, nil, 201)
	if !strings.Contains(join.Body.String(), `"name":"学生01"`) {
		t.Fatal("first student did not get seat 01")
	}
	student := join.Result().Cookies()[0]
	exercise(t, app, "POST", "/api/student/current", device, nil, 200)
	exercise(t, app, "GET", teacherRoom, nil, student, 401)
	exercise(t, app, "POST", teacherRoom+"/activity/1", map[string]bool{"open": true}, student, 401)

	answers := []any{
		testAnswer([]string{"camera", "power", "control", "gps", "radio", "battery", "flight"}, ""),
		testAnswer([]string{"desktop", "phone", "bike"}, ""),
		testAnswer([]string{"chair", "heat", "massage", "music"}, "模块可分别检测。"),
		testAnswer([]string{"amber", "call-1", "call-2", "call-3"}, "只换一次，三处都变了。"),
		testAnswer([]string{"psu", "ram", "disk", "screen", "keyboard"}, ""),
		testAnswer([]string{"hall", "drive", "avoid", "voice"}, "=避障后让行走模块停止。"),
	}
	for idx, answer := range answers {
		path := "/activity/" + string(rune('1'+idx))
		exercise(t, app, "GET", studentRoom+path, nil, student, 423)
		exercise(t, app, "POST", studentRoom+path, answer, student, 423)
		exercise(t, app, "POST", teacherRoom+path, map[string]bool{"open": true}, teacher, 200)
		exercise(t, app, "GET", studentRoom+path, nil, student, 200)
		exercise(t, app, "POST", studentRoom+path, testAnswer([]string{"unknown"}, ""), student, 400)
		exercise(t, app, "POST", studentRoom+path, answer, student, 200)
	}
	dashboard := exercise(t, app, "GET", teacherRoom, nil, teacher, 200)
	if !strings.Contains(dashboard.Body.String(), `"complete":1`) || !strings.Contains(dashboard.Body.String(), `"counts":[1,1,1,1,1,1]`) {
		t.Fatalf("incorrect totals: %s", dashboard.Body.String())
	}
	export := exercise(t, app, "GET", teacherRoom+"/export", nil, teacher, 200)
	if !strings.Contains(export.Body.String(), "校园安全卫士") || !strings.Contains(export.Body.String(), "'=避障") {
		t.Fatal("CSV missing activity or escaped cell")
	}
	exercise(t, app, "POST", teacherRoom+"/activity/6", map[string]bool{"open": false}, teacher, 200)
	exercise(t, app, "POST", studentRoom+"/activity/6", answers[5], student, 423)
	reopened, err := newServer(dataDir, password, true)
	if err != nil {
		t.Fatal(err)
	}
	status := exercise(t, reopened, "GET", studentRoom+"/status", nil, student, 200)
	if !strings.Contains(status.Body.String(), `"done":[true,true,true,true,true,true]`) {
		t.Fatal("student and submissions must survive restart")
	}
	exercise(t, reopened, "GET", studentRoom+"/activity/6", nil, student, 423)
	exercise(t, app, "POST", teacherRooms, map[string]string{"title": "六年级二班"}, teacher, 409)
	other := create("六年级二班", room.Code)
	exercise(t, app, "GET", studentRoom+"/status", nil, student, 410)
	exercise(t, app, "POST", teacherRoom+"/activity/1", map[string]bool{"open": true}, teacher, 410)
	exercise(t, app, "GET", teacherRoom+"/export", nil, teacher, 200)
	transferred := exercise(t, app, "POST", "/api/student/current", device, student, 201)
	if !strings.Contains(transferred.Body.String(), other.Code) || !strings.Contains(transferred.Body.String(), "学生01") {
		t.Fatal("existing browser should join the next classroom with a fresh seat and no old progress")
	}
	reopened, err = newServer(dataDir, password, true)
	if err != nil || reopened.active != other.Code {
		t.Fatal("active classroom was not restored", err)
	}
	exercise(t, app, "POST", "/api/teacher/logout", struct{}{}, teacher, 200)
	exercise(t, app, "GET", teacherRoom, nil, teacher, 401)
}

func TestFiftyConcurrentJoins(t *testing.T) {
	app, err := newServer(t.TempDir(), "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "50 台电脑"}, teacher, 201)
	service := httptest.NewServer(app.handler())
	defer service.Close()
	var group sync.WaitGroup
	names := make(chan string, seatLimit)
	for range seatLimit {
		group.Add(1)
		go func() {
			defer group.Done()
			body, err := service.Client().Post(service.URL+"/api/student/current", "application/json", strings.NewReader(fmt.Sprintf(`{"device":%q}`, token(32))))
			if err != nil {
				t.Error(err)
				return
			}
			defer body.Body.Close()
			var joined struct{ Name string }
			if err := json.NewDecoder(body.Body).Decode(&joined); err != nil || body.StatusCode != 201 {
				t.Errorf("join returned HTTP %d: %v", body.StatusCode, err)
				return
			}
			names <- joined.Name
		}()
	}
	group.Wait()
	close(names)
	unique := map[string]bool{}
	for name := range names {
		if unique[name] {
			t.Errorf("duplicate seat %s", name)
		}
		unique[name] = true
	}
	for seat := 1; seat <= seatLimit; seat++ {
		if name := fmt.Sprintf("学生%02d", seat); !unique[name] {
			t.Errorf("missing seat %s", name)
		}
	}
	exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 409)
	summary := exercise(t, app, "GET", "/api/teacher/rooms/"+app.active+"/live-seats", nil, teacher, 200)
	var roster struct{ Seats []seatProgress }
	if err := json.Unmarshal(summary.Body.Bytes(), &roster); err != nil || len(roster.Seats) != seatLimit {
		t.Fatalf("projection roster should include all 50 seats: %d (%v)", len(roster.Seats), err)
	}
}

func TestLiveProjection(t *testing.T) {
	app, err := newServer(t.TempDir(), "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "投屏测试"}, teacher, 201)
	student := exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201).Result().Cookies()[0]
	route := "/api/student/" + app.active + "/live"
	room := "/api/teacher/rooms/" + app.active
	watch := room + "/live?seat=1"
	roster := room + "/live-seats"
	frame := liveFrame{Stage: 1, Draft: liveDraft{Values: []string{"battery"}, Focus: "battery", Notice: "mounted", Text: "不应出现在座位摘要"}}
	exercise(t, app, "GET", watch, nil, student, 401)
	exercise(t, app, "GET", roster, nil, student, 401)
	waiting := exercise(t, app, "GET", roster, nil, teacher, 200)
	if !strings.Contains(waiting.Body.String(), `"seats":[{"seat":1}]`) {
		t.Fatal("joined seats should be available before opening an activity")
	}
	exercise(t, app, "POST", route, frame, student, 423)
	exercise(t, app, "POST", room+"/activity/1", map[string]bool{"open": true}, teacher, 200)
	exercise(t, app, "POST", route, frame, student, 204)
	summary := exercise(t, app, "GET", roster, nil, teacher, 200)
	var seats struct {
		Revision string
		Seats    []seatProgress
	}
	if err := json.Unmarshal(summary.Body.Bytes(), &seats); err != nil || seats.Revision == "" || len(seats.Seats) != 1 || seats.Seats[0] != (seatProgress{Seat: 1, Stage: 1, Count: 1}) {
		t.Fatalf("wrong seat progress: %#v (%v)", seats, err)
	}
	if strings.Contains(summary.Body.String(), "battery") || strings.Contains(summary.Body.String(), frame.Draft.Text) {
		t.Fatal("seat summaries must not contain student drafts")
	}
	exercise(t, app, "GET", roster+"?since="+seats.Revision, nil, teacher, 204)
	seen := exercise(t, app, "GET", watch, nil, teacher, 200)
	var view struct {
		liveFrame
		Content json.RawMessage
	}
	if err := json.Unmarshal(seen.Body.Bytes(), &view); err != nil || view.Revision == 0 || view.Draft.Focus != "battery" || len(view.Content) == 0 {
		t.Fatalf("projection missing the draft or catalog: %v", err)
	}
	exercise(t, app, "GET", fmt.Sprintf("%s&since=%d&catalog=1", watch, view.Revision), nil, teacher, 204)
	filtered := exercise(t, app, "GET", watch+"&catalog=1", nil, teacher, 200)
	if strings.Contains(filtered.Body.String(), `"content"`) {
		t.Fatal("unchanged catalog should not be sent again")
	}
	exercise(t, app, "POST", room+"/activity/1", map[string]bool{"open": false}, teacher, 200)
	waiting = exercise(t, app, "GET", roster+"?since="+seats.Revision, nil, teacher, 200)
	if strings.Contains(waiting.Body.String(), `"stage"`) {
		t.Fatal("locked activity remained in seat summary")
	}
	closed := exercise(t, app, "GET", watch, nil, teacher, 200)
	if strings.Contains(closed.Body.String(), "battery") {
		t.Fatal("locked activity remained visible")
	}
}
