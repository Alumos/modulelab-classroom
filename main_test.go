package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
)

func exercise(t *testing.T, app *server, method, path string, input any, cookie *http.Cookie, expected int, reset ...string) *httptest.ResponseRecorder {
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
	if len(reset) > 0 {
		req.Header.Set("X-Classroom-Reset", reset[0])
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

func TestSiteFilingFooter(t *testing.T) {
	app, err := newServer(t.TempDir(), "2026", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, page := range []string{"/", "/teacher", "/teacher/"} {
		response := exercise(t, app, "GET", page, nil, nil, 200)
		if !strings.Contains(response.Body.String(), `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2021038338号-1</a>`) {
			t.Errorf("%s is missing the filing link", page)
		}
	}
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
		testAnswer([]string{"device-chair", "massage", "music", "heat", "air", "panel"}, ""),
		testAnswer([]string{"parallel", "reuse", "unit-test", "repair", "combine"}, ""),
		testAnswer(append(slices.Clone(lightCalls), "blue:500:on", "blue:500:on", "blue:500:on", "blue:500:on", "blue:500:on", "amber:500:on", "7"), "只换一次，五处都变了。"),
		testAnswer([]string{"psu", "ram", "disk", "gpu", "screen", "keyboard", "mouse", "sata-wire", "hdmi-wire"}, ""),
		testAnswer([]string{"wash", "cargo", "thermal"}, "=换上不同模块，能做不同的事。"),
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
	if !strings.Contains(export.Body.String(), "无人机改造畅想") || !strings.Contains(export.Body.String(), "运输挂钩 · 运送茶叶") || !strings.Contains(export.Body.String(), "'=换上") {
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

func TestConcurrentJoinsBeyondFifty(t *testing.T) {
	const students = 120
	dataDir := t.TempDir()
	app, err := newServer(dataDir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "并发入场"}, teacher, 201)
	service := httptest.NewServer(app.handler())
	defer service.Close()
	var group sync.WaitGroup
	names := make(chan string, students)
	for range students {
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
	for seat := 1; seat <= students; seat++ {
		if name := fmt.Sprintf("学生%02d", seat); !unique[name] {
			t.Errorf("missing seat %s", name)
		}
	}
	room := "/api/teacher/rooms/" + app.active
	summary := exercise(t, app, "GET", room+"/live-seats", nil, teacher, 200)
	var roster struct{ Seats []seatProgress }
	if err := json.Unmarshal(summary.Body.Bytes(), &roster); err != nil || len(roster.Seats) != students {
		t.Fatalf("projection roster should include all %d seats: got %d (%v)", students, len(roster.Seats), err)
	}
	for index, entry := range roster.Seats {
		if entry.Seat != index+1 {
			t.Fatalf("projection roster is out of order at seat %d: %d", index+1, entry.Seat)
		}
	}
	device := map[string]string{"device": token(32)}
	joined := exercise(t, app, "POST", "/api/student/current", device, nil, 201)
	name := fmt.Sprintf("学生%02d", students+1)
	if !strings.Contains(joined.Body.String(), name) {
		t.Fatalf("new student should get %s: %s", name, joined.Body.String())
	}
	student := joined.Result().Cookies()[0]
	exercise(t, app, "POST", room+"/activity/1", map[string]bool{"open": true}, teacher, 200)
	frame := liveFrame{Stage: 1, Draft: liveDraft{Values: []string{"battery"}}}
	exercise(t, app, "POST", "/api/student/"+app.active+"/live", frame, student, 204)
	view := exercise(t, app, "GET", room+"/live?seat="+fmt.Sprint(students+1), nil, teacher, 200)
	if !strings.Contains(view.Body.String(), `"values":["battery"]`) {
		t.Fatal("projection did not show the new student's progress")
	}
	reopened, err := newServer(dataDir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	returned := exercise(t, reopened, "POST", "/api/student/current", device, nil, 200)
	next := exercise(t, reopened, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201)
	if !strings.Contains(returned.Body.String(), name) || !strings.Contains(next.Body.String(), fmt.Sprintf("学生%02d", students+2)) {
		t.Fatal("seat numbers should survive restart and keep increasing")
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

func TestUpdatedActivities(t *testing.T) {
	app, err := newServer(t.TempDir(), "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "新活动"}, teacher, 201)
	student := exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201).Result().Cookies()[0]
	room := app.rooms[app.active]
	teacherPath := "/api/teacher/rooms/" + app.active
	studentPath := "/api/student/" + app.active
	legacy := map[int][]string{1: {"desktop", "phone", "bike"}, 2: {"chair", "heat", "massage", "music"}, 4: legacyWiring}
	for idx, answer := range legacy {
		path := fmt.Sprintf("/activity/%d", idx+1)
		for _, person := range room.People {
			person.Answers[idx] = &submission{Values: answer}
		}
		exercise(t, app, "POST", teacherPath+path, map[string]bool{"open": true}, teacher, 200)
		activity := exercise(t, app, "GET", studentPath+path, nil, student, 200).Body.String()
		if !strings.Contains(activity, `"answer":null`) {
			t.Fatalf("legacy answer should not prefill %s", path)
		}
		exercise(t, app, "POST", studentPath+path, testAnswer(answer, ""), student, 400)
	}
	export := exercise(t, app, "GET", teacherPath+"/export", nil, teacher, 200).Body.String()
	for _, label := range []string{"生活搜寻,台式电脑", "小组研究,家居组 / 按摩椅", "电脑组装,电源 → 24 针供电接口"} {
		if !strings.Contains(export, label) {
			t.Fatalf("legacy export is missing %q", label)
		}
	}
	for _, device := range devices {
		if device.SlotCount < 5 || len(device.Modules)-device.SlotCount < 3 || !unique(itemIDs(device.Modules)) {
			t.Fatalf("incomplete exercise for %s", device.Name)
		}
	}
	for _, invalid := range [][]string{
		{"device-chair", "heat", "massage"},
		{"device-chair", "", "", "", "", ""},
		{"device-chair", "heat", "massage", "music", "air", "screen"},
		{"device-chair", "heat", "massage", "music", "air", "heat"},
	} {
		exercise(t, app, "POST", studentPath+"/activity/2", testAnswer(invalid, ""), student, 400)
	}
	exercise(t, app, "POST", studentPath+"/activity/3", testAnswer([]string{"combine", "repair", "parallel", "reuse", "unknown"}, ""), student, 400)
	badSlots := slices.Clone(wiring)
	badSlots[7], badSlots[8] = badSlots[8], badSlots[7]
	exercise(t, app, "POST", studentPath+"/activity/5", testAnswer(badSlots, ""), student, 400)
	frame := liveFrame{Stage: 2, Draft: liveDraft{Selected: "device-phone", Slots: []string{"", "screw", "", "", "", ""}}}
	exercise(t, app, "POST", studentPath+"/live", frame, student, 204)
	view := exercise(t, app, "GET", teacherPath+"/live?seat=1", nil, teacher, 200).Body.String()
	if !strings.Contains(view, `"done":false`) || !strings.Contains(view, `"slots":["","screw","","","",""]`) || strings.Contains(view, `"solution"`) {
		t.Fatal("projection should display the actual choice, without an answer key or the legacy answer")
	}
	seats := exercise(t, app, "GET", teacherPath+"/live-seats", nil, teacher, 200).Body.String()
	if !strings.Contains(seats, `"stage":2,"count":1,"total":6`) || strings.Contains(seats, "screw") {
		t.Fatal("seat summary should expose only the count and total")
	}
	for _, draft := range []liveDraft{{Slots: []string{"combine", "", "combine", "", ""}}, {Slots: []string{"combine", "", "unknown", "", ""}}} {
		exercise(t, app, "POST", studentPath+"/live", liveFrame{Stage: 3, Draft: draft}, student, 400)
	}
	if !validLive(3, liveDraft{Slots: []string{"", "cost", "", "", ""}}) || !validLive(5, liveDraft{Slots: wiring, On: true, Playing: true}) {
		t.Fatal("the new activities must accept valid live frames")
	}
	for _, record := range []struct {
		stage  string
		values []string
		label  string
	}{
		{"2", append([]string{"device-phone"}, frame.Draft.Slots...), "一颗螺丝"},
		{"3", []string{"combine", "", "cost", "", ""}, "一定更便宜"},
		{"3", []string{"combine", "repair", "parallel", "reuse", "cost"}, "一定更便宜"},
	} {
		path := studentPath + "/activity/" + record.stage
		exercise(t, app, "POST", path, testAnswer(record.values, ""), student, 200)
		response := exercise(t, app, "GET", path, nil, student, 200)
		var activity struct{ Answer *submission }
		if err := json.Unmarshal(response.Body.Bytes(), &activity); err != nil || activity.Answer == nil || !slices.Equal(activity.Answer.Values, record.values) {
			t.Fatalf("activity %s should restore the submitted slots: %s", record.stage, response.Body.String())
		}
		results := exercise(t, app, "GET", teacherPath+"/results?stage="+record.stage, nil, teacher, 200).Body.String()
		if !strings.Contains(results, record.label) {
			t.Fatalf("activity %s teacher results should show %q", record.stage, record.label)
		}
	}
	if validLive(5, liveDraft{Slots: badSlots}) || validLive(5, liveDraft{Slots: make([]string, len(wiring)), On: true}) {
		t.Fatal("projection should reject swapped cables and an incomplete boot")
	}
}

func TestRetrofitWorkspace(t *testing.T) {
	app, err := newServer(t.TempDir(), "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "改装测试"}, teacher, 201)
	join := exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201)
	student := join.Result().Cookies()[0]
	room := app.rooms[app.active]
	teacherPath := "/api/teacher/rooms/" + app.active
	studentPath := "/api/student/" + app.active
	for _, person := range room.People {
		person.Answers[5] = &submission{Values: []string{"hall", "drive", "avoid"}, Text: "旧课堂记录"}
	}
	exercise(t, app, "POST", teacherPath+"/activity/6", map[string]bool{"open": true}, teacher, 200)
	oldExport := exercise(t, app, "GET", teacherPath+"/export", nil, teacher, 200).Body.String()
	if !strings.Contains(oldExport, "校园安全卫士,走廊巡逻；行走驱动；红外避障") {
		t.Fatal("legacy export lost activity name or answer labels")
	}
	oldDetails := exercise(t, app, "GET", teacherPath+"/results?stage=6", nil, teacher, 200).Body.String()
	if !strings.Contains(oldDetails, `"activity":"校园安全卫士"`) {
		t.Fatal("legacy results must be labeled as such")
	}
	activity := exercise(t, app, "GET", studentPath+"/activity/6", nil, student, 200).Body.String()
	if !strings.Contains(activity, `"answer":null`) || !strings.Contains(activity, "热成像相机") || strings.Contains(activity, `"jobs"`) {
		t.Fatal("old answer should not prefill the new activity")
	}
	for _, invalid := range [][]string{nil, {"hall", "drive"}, {"wash", "wash"}, {"wash", "unknown"}} {
		exercise(t, app, "POST", studentPath+"/activity/6", testAnswer(invalid, ""), student, 400)
	}
	exercise(t, app, "POST", studentPath+"/live", liveFrame{Stage: 6, Draft: liveDraft{Values: []string{"drive"}}}, student, 400)
	frame := liveFrame{Stage: 6, Draft: liveDraft{Values: []string{"wash", "drop"}, Playing: true, Step: 3}}
	exercise(t, app, "POST", studentPath+"/live", frame, student, 204)
	view := exercise(t, app, "GET", teacherPath+"/live?seat=1", nil, teacher, 200).Body.String()
	if !strings.Contains(view, `"done":false`) || !strings.Contains(view, `"values":["wash","drop"]`) || !strings.Contains(view, `"step":3`) {
		t.Fatal("projection must show the new selection without counting the legacy answer")
	}
	seats := exercise(t, app, "GET", teacherPath+"/live-seats", nil, teacher, 200).Body.String()
	if !strings.Contains(seats, `{"seat":1,"stage":6,"count":2}`) || strings.Contains(seats, "drop") {
		t.Fatal("seat cards should only receive the module count")
	}
	saved := exercise(t, app, "POST", studentPath+"/activity/6", testAnswer(frame.Draft.Values, ""), student, 200).Body.String()
	if !strings.Contains(saved, `"done":[false,false,false,false,false,true]`) {
		t.Fatal("submitting a new activity must mark it complete")
	}
	activity = exercise(t, app, "GET", studentPath+"/activity/6", nil, student, 200).Body.String()
	if !strings.Contains(activity, `"values":["wash","drop"]`) {
		t.Fatal("saved module order must restore the most recent attachment")
	}
}

func TestLightWorkspace(t *testing.T) {
	app, err := newServer(t.TempDir(), "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "积木编程"}, teacher, 201)
	student := exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201).Result().Cookies()[0]
	room := "/api/teacher/rooms/" + app.active
	studentPath := "/api/student/" + app.active
	activity := studentPath + "/activity/4"
	exercise(t, app, "POST", room+"/activity/4", map[string]bool{"open": true}, teacher, 200)

	direct := []lightSetting{{"red", 1000, true}, {"blue", 500, true}, {"green", 500, true}, {"purple", 500, true}, {"blue", 500, true}}
	shared := lightSetting{"blue", 1500, false}
	const waitAndOff = 6
	draft := liveDraft{Values: lightCalls, Mode: "new", Preview: 3, Playing: true, LightStep: "wait", LightLamp: "purple", LightClosed: true,
		Lights: &lightWorkspace{Direct: direct, Shared: &shared, Mask: waitAndOff}}
	frame := liveFrame{Stage: 4, Draft: draft}
	invalid := frame
	invalid.Draft.LightStep = "unknown"
	exercise(t, app, "POST", studentPath+"/live", invalid, student, 400)
	invalid = frame
	invalid.Draft.Lights = &lightWorkspace{Direct: direct[:2], Shared: &shared, Mask: waitAndOff}
	exercise(t, app, "POST", studentPath+"/live", invalid, student, 400)
	invalid = frame
	invalid.Draft.Lights = &lightWorkspace{Direct: direct, Shared: &shared, Mask: 8}
	exercise(t, app, "POST", studentPath+"/live", invalid, student, 400)
	if !validLive(4, liveDraft{Mode: "old", LightPick: 3, Lights: &lightWorkspace{Direct: direct, Mask: waitAndOff}}) ||
		validLive(4, liveDraft{Mode: "old", Lights: &lightWorkspace{Direct: direct, Mask: waitAndOff}}) {
		t.Fatal("preparing a module must carry a valid choice and source event")
	}
	exercise(t, app, "POST", studentPath+"/live", frame, student, 204)
	mirror := exercise(t, app, "GET", room+"/live?seat=1", nil, teacher, 200)
	var projected liveFrame
	if err := json.Unmarshal(mirror.Body.Bytes(), &projected); err != nil {
		t.Fatal(err)
	}
	if projected.Draft.Lights == nil || projected.Draft.Lights.Shared == nil || *projected.Draft.Lights.Shared != shared ||
		!slices.Equal(projected.Draft.Lights.Direct, direct) || projected.Draft.Lights.Mask != waitAndOff ||
		projected.Draft.LightStep != "wait" || projected.Draft.LightLamp != "purple" || projected.Draft.Preview != 3 || !projected.Draft.LightClosed {
		t.Fatalf("projection did not preserve the workspace: %#v", projected.Draft)
	}

	legacy := []string{"blue", "call-1", "call-2", "call-3", "red:1000:on", "blue:500:on", "blue:500:on", "blue:1500:off"}
	previous := displayValues(3, legacy)
	if !slices.Contains(previous, "降落后调用") || slices.Contains(previous, "左转调用") {
		t.Fatal("historical records must keep the original events")
	}
	values := append(slices.Clone(lightCalls), "red:1000:on", "blue:500:on", "green:500:on", "purple:500:on", "blue:500:on", "blue:1500:off", "6")
	const reflection = "独立积木只改一段，共用等待积木一次改五段。"
	exercise(t, app, "POST", activity, testAnswer(values[:5], reflection), student, 400)
	for _, malformed := range []string{"blue:1300:on", "blue:500:maybe", "orange:500:on"} {
		bad := slices.Clone(values)
		bad[10] = malformed
		exercise(t, app, "POST", activity, testAnswer(bad, reflection), student, 400)
	}
	bad := slices.Clone(values)
	bad[11] = "0"
	exercise(t, app, "POST", activity, testAnswer(bad, reflection), student, 400)
	exercise(t, app, "POST", activity, testAnswer(values, reflection), student, 200)
	stored := exercise(t, app, "GET", activity, nil, student, 200)
	if !strings.Contains(stored.Body.String(), "blue:1500:off") || !strings.Contains(stored.Body.String(), "red:1000:on") {
		t.Fatal("both programs must survive submission")
	}
	record := exercise(t, app, "GET", room+"/results?stage=4", nil, teacher, 200)
	if !strings.Contains(record.Body.String(), "右转调用") || !strings.Contains(record.Body.String(), "独立 · 左转：绿色 · 0.5 秒") || !strings.Contains(record.Body.String(), "共用模块：1.5 秒 · 熄灭彩灯") {
		t.Fatal("teacher record must show the new events and only the encapsulated commands")
	}
}

func TestClearCurrentStudents(t *testing.T) {
	dir := t.TempDir()
	app, err := newServer(dir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher := exercise(t, app, "POST", "/api/teacher/login", map[string]string{"password": "2026"}, nil, 200).Result().Cookies()[0]
	const classes = "/api/teacher/rooms"
	const join = "/api/student/current"
	device := map[string]string{"device": token(32)}
	reset := map[string]uint64{"reset": 0}
	answer := testAnswer([]string{"device-chair", "heat", "massage", "music", "air", "panel"}, "")
	frame := liveFrame{Stage: 2, Draft: liveDraft{Selected: "device-chair", Slots: []string{"heat", "", "", "", ""}}}
	exercise(t, app, "POST", classes, map[string]string{"title": "之前的课"}, teacher, 201)
	archived := app.active
	exercise(t, app, "POST", classes+"/"+archived+"/activity/2", map[string]bool{"open": true}, teacher, 200)
	student := exercise(t, app, "POST", join, device, nil, 201).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/student/"+archived+"/activity/2", answer, student, 200)
	exercise(t, app, "POST", classes, map[string]string{"title": "试课", "replace": archived}, teacher, 201)
	current := classes + "/" + app.active
	studentURL := "/api/student/" + app.active
	student = exercise(t, app, "POST", join, device, student, 201).Result().Cookies()[0]
	exercise(t, app, "POST", current+"/activity/2", map[string]bool{"open": true}, teacher, 200)
	exercise(t, app, "POST", studentURL+"/live", frame, student, 204)
	exercise(t, app, "POST", studentURL+"/activity/2", answer, student, 200)
	exercise(t, app, "POST", current+"/clear-students", reset, student, 401)
	exercise(t, app, "POST", classes+"/"+archived+"/clear-students", reset, teacher, 410)
	cleared := exercise(t, app, "POST", current+"/clear-students", reset, teacher, 200).Body.String()
	if !strings.Contains(cleared, `"enrolled":0`) || !strings.Contains(cleared, `"reset":1`) || !strings.Contains(cleared, `"open":[false,true,false,false,false,false]`) {
		t.Fatal("clear must empty only student data and keep the same activities open")
	}
	exercise(t, app, "GET", studentURL+"/status", nil, student, 401)
	exercise(t, app, "GET", current+"/live?seat=1", nil, teacher, 404)
	if !strings.Contains(exercise(t, app, "GET", current+"/live-seats", nil, teacher, 200).Body.String(), `"seats":[]`) ||
		strings.TrimSpace(exercise(t, app, "GET", current+"/results?stage=2", nil, teacher, 200).Body.String()) != "[]" ||
		!strings.Contains(exercise(t, app, "GET", classes+"/"+archived+"/results?stage=2", nil, teacher, 200).Body.String(), "学生01") {
		t.Fatal("clear must remove active submissions and projection without touching previous classes")
	}
	reopened, err := newServer(dir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	stored := reopened.rooms[app.active]
	if len(stored.People) != 0 || stored.Reset != 1 || !stored.Open[1] {
		t.Fatal("clear must survive restart")
	}
	rejoined := exercise(t, app, "POST", join, device, student, 201)
	student = rejoined.Result().Cookies()[0]
	if !strings.Contains(rejoined.Body.String(), `"name":"学生01"`) || !strings.Contains(rejoined.Body.String(), `"done":[false,false,false,false,false,false]`) {
		t.Fatal("returning browsers must get a fresh seat with no progress")
	}
	exercise(t, app, "POST", current+"/clear-students", reset, teacher, 409)
	exercise(t, app, "POST", studentURL+"/activity/2", answer, student, 409, "0")
	exercise(t, app, "POST", studentURL+"/live", frame, student, 409, "0")
	exercise(t, app, "POST", studentURL+"/live", frame, student, 204, "1")
	exercise(t, app, "POST", studentURL+"/activity/2", answer, student, 200, "1")
}
