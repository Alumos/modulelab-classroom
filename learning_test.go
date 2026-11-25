package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestLearningDashboard(t *testing.T) {
	dataDir := t.TempDir()
	app, err := newServer(dataDir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	credentials := map[string]string{"password": "2026"}
	teacher := exercise(t, app, "POST", "/api/teacher/login", credentials, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "课堂看板"}, teacher, 201)
	room := app.rooms[app.active]
	teacherPath := "/api/teacher/rooms/" + room.Code
	studentPath := "/api/student/" + room.Code
	path := teacherPath + "/learning"
	summary := func() learningSummary {
		t.Helper()
		var data learningSummary
		body := exercise(t, app, "GET", path, nil, teacher, 200).Body.String()
		for _, raw := range []string{"学生01", "stitch", "whole", "临时观察记录"} {
			if strings.Contains(body, raw) {
				t.Fatalf("dashboard exposed raw data: %s", raw)
			}
		}
		if err := json.Unmarshal([]byte(body), &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	if data := summary(); !data.Active || data.HasStudents || data.Overall != (learningRate{}) {
		t.Fatalf("unexpected empty dashboard: %+v", data)
	}
	student := exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201)
	exercise(t, app, "GET", path, nil, student, 401)
	for _, index := range []string{"2", "3", "6"} {
		exercise(t, app, "POST", teacherPath+"/activity/"+index, map[string]bool{"open": true}, teacher, 200)
	}
	exercise(t, app, "POST", studentPath+"/live", liveFrame{Stage: 2, Draft: liveDraft{Selected: "device-chair", Slots: make([]string, 5)}}, student, 204)
	if data := summary(); !data.HasStudents || data.Distribution[0] != 100 || data.Overall != (learningRate{}) {
		t.Fatalf("opening the task alone should not count as work: %+v", data)
	}
	advance := func(frame liveFrame) {
		t.Helper()
		room.People[digest(student.Value)].live.At = time.Time{}
		exercise(t, app, "POST", studentPath+"/live", frame, student, 204)
	}
	advance(liveFrame{Stage: 2, Draft: liveDraft{Selected: "device-chair", Slots: []string{"stitch", "", "", "", ""}}})
	if data := summary(); data.Overall != (learningRate{Attempted: 50}) || data.Stages[1] != (learningRate{Attempted: 50}) || data.Distribution != ([7]float64{50, 50}) {
		t.Fatalf("placing a plausible distractor should count only as an attempt: %+v", data)
	}
	exercise(t, app, "POST", studentPath+"/activity/2", testAnswer([]string{"device-chair", "stitch", "", "", "", ""}, ""), student, 200)
	advance(liveFrame{Stage: 3, Draft: liveDraft{Slots: []string{"", "cost", "whole", "", ""}}})
	exercise(t, app, "POST", studentPath+"/activity/6", testAnswer([]string{retrofitModules[0].ID}, "临时观察记录"), student, 200)
	advance(liveFrame{Stage: 3, Draft: liveDraft{Slots: make([]string, 5)}})
	data := summary()
	if data.Overall != (learningRate{50, 50, 50}) || data.Stages[1] != (learningRate{50, 50, 0}) || data.Stages[2] != (learningRate{50, 0, 50}) ||
		data.Stages[5] != (learningRate{50, 50, 0}) || data.Distribution != ([7]float64{50, 0, 0, 50}) {
		t.Fatalf("dashboard should retain reached milestones and separate them from submissions: %+v", data)
	}
	exercise(t, app, "GET", path+"?since="+data.Revision, nil, teacher, 204)
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "下一堂", "replace": room.Code}, teacher, 201)
	if data := summary(); data.Active || data.Overall != (learningRate{50, 50, 50}) {
		t.Fatalf("archived dashboard should retain the session evidence: %+v", data)
	}
	app, err = newServer(dataDir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher = exercise(t, app, "POST", "/api/teacher/login", credentials, nil, 200).Result().Cookies()[0]
	if data := summary(); data.Active || data.Overall != (learningRate{50, 50, 0}) || data.Distribution != ([7]float64{50, 0, 50}) {
		t.Fatalf("only durable submissions should survive restart: %+v", data)
	}
	path = "/api/teacher/rooms/" + app.active + "/learning"
	exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201)
	beforeClear := summary()
	exercise(t, app, "POST", "/api/teacher/rooms/"+app.active+"/clear-students", map[string]int{"reset": 0}, teacher, 200)
	if data := summary(); data.HasStudents || data.Revision == beforeClear.Revision || data.Distribution != ([7]float64{}) {
		t.Fatalf("clearing the classroom should reset the dashboard: %+v", data)
	}
}

func TestRatingAndComputerProgress(t *testing.T) {
	dataDir := t.TempDir()
	app, err := newServer(dataDir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	credentials := map[string]string{"password": "2026"}
	teacher := exercise(t, app, "POST", "/api/teacher/login", credentials, nil, 200).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/teacher/rooms", map[string]string{"title": "装机看板"}, teacher, 201)
	teacherPath := "/api/teacher/rooms/" + app.active
	studentPath := "/api/student/" + app.active
	student := exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201).Result().Cookies()[0]
	exercise(t, app, "POST", "/api/student/current", map[string]string{"device": token(32)}, nil, 201)
	assertComputer := func(want computerProgress) {
		t.Helper()
		var data learningSummary
		if err := json.Unmarshal(exercise(t, app, "GET", teacherPath+"/learning", nil, teacher, 200).Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		if data.Computer != want {
			t.Fatalf("computer progress: got %+v, want %+v", data.Computer, want)
		}
	}
	activity := studentPath + "/activity/5"
	record := map[string]any{"values": wiring, "rating": 3}
	exercise(t, app, "POST", activity, record, student, 423)
	exercise(t, app, "POST", teacherPath+"/activity/5", map[string]bool{"open": true}, teacher, 200)
	for _, bad := range []any{0, 6, -1, 3.5, "3"} {
		record["rating"] = bad
		exercise(t, app, "POST", activity, record, student, 400)
	}
	assertComputer(computerProgress{})
	exercise(t, app, "POST", studentPath+"/live", liveFrame{Stage: 5, Draft: liveDraft{Slots: wiring, On: true, Playing: true}}, student, 204)
	assertComputer(computerProgress{})
	app.rooms[app.active].People[digest(student.Value)].live.At = time.Time{}
	exercise(t, app, "POST", studentPath+"/live", liveFrame{Stage: 5, Draft: liveDraft{Slots: wiring, On: true}}, student, 204)
	assertComputer(computerProgress{Booted: 1})
	record["rating"] = 4
	response := exercise(t, app, "POST", activity, record, student, 200).Body.String()
	if !strings.Contains(response, `"ratings":[0,0,0,0,4,0]`) {
		t.Fatalf("saved stars missing from student status: %s", response)
	}
	exercise(t, app, "POST", activity, testAnswer(wiring, ""), student, 200)
	assertComputer(computerProgress{Booted: 1, Submitted: 1})
	if csv := exercise(t, app, "GET", teacherPath+"/export", nil, teacher, 200).Body.String(); !strings.Contains(csv, "自评星数") || !strings.HasSuffix(csv, ",4\r\n") {
		t.Fatalf("export missing saved stars: %s", csv)
	}
	app, err = newServer(dataDir, "", false)
	if err != nil {
		t.Fatal(err)
	}
	teacher = exercise(t, app, "POST", "/api/teacher/login", credentials, nil, 200).Result().Cookies()[0]
	if body := exercise(t, app, "GET", activity, nil, student, 200).Body.String(); !strings.Contains(body, `"rating":4`) {
		t.Fatalf("rating was not restored after restarting: %s", body)
	}
	assertComputer(computerProgress{Booted: 1, Submitted: 1})
}
