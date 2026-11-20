package main

import (
	"net/http"
	"sort"
	"strconv"
	"time"
)

type lightWorkspace struct {
	Direct []lightSetting `json:"direct"`
	Shared *lightSetting  `json:"shared"`
	Mask   int            `json:"mask"`
}

type liveDraft struct {
	Values      []string        `json:"values"`
	Text        string          `json:"text,omitempty"`
	Selected    string          `json:"selected,omitempty"`
	Focus       string          `json:"focus,omitempty"`
	Notice      string          `json:"notice,omitempty"`
	Wrong       bool            `json:"wrong,omitempty"`
	Slots       []string        `json:"slots,omitempty"`
	Playing     bool            `json:"playing,omitempty"`
	Flight      bool            `json:"flight,omitempty"`
	Step        int             `json:"step"`
	Preview     int             `json:"preview"`
	Mode        string          `json:"mode,omitempty"`
	On          bool            `json:"on,omitempty"`
	Lights      *lightWorkspace `json:"lights,omitempty"`
	LightStep   string          `json:"lightStep,omitempty"`
	LightClosed bool            `json:"lightClosed,omitempty"`
	LightPick   int             `json:"lightPick,omitempty"`
	LightLamp   string          `json:"lightLamp,omitempty"`
}

type liveFrame struct {
	Stage    int       `json:"stage"`
	Draft    liveDraft `json:"draft"`
	Revision uint64    `json:"revision"`
	At       time.Time `json:"at"`
}

type seatProgress struct {
	Seat  int  `json:"seat"`
	Stage int  `json:"stage,omitempty"`
	Count int  `json:"count,omitempty"`
	Total int  `json:"total,omitempty"`
	Ready bool `json:"ready,omitempty"`
	Done  bool `json:"done,omitempty"`
}

func progressFor(person *participant, frame *liveFrame) seatProgress {
	entry := seatProgress{Seat: person.Seat}
	if frame == nil || frame.Stage == 0 {
		return entry
	}
	entry.Stage = frame.Stage
	entry.Count = len(frame.Draft.Values)
	entry.Done = currentAnswer(frame.Stage-1, person.Answers[frame.Stage-1]) != nil
	switch frame.Stage {
	case 1:
		entry.Ready = frame.Draft.Flight
	case 4:
		entry.Total = len(lightCalls)
	case 2, 3, 5:
		entry.Total = len(frame.Draft.Slots)
		entry.Ready = frame.Stage == 5 && frame.Draft.On && !frame.Draft.Playing
		entry.Count = 0
		for _, part := range frame.Draft.Slots {
			if part != "" {
				entry.Count++
			}
		}
	}
	return entry
}

func (app *server) liveSeats(res http.ResponseWriter, req *http.Request, room *classroom) {
	if room.Code != app.active {
		reject(res, 410, "这堂课已结束。")
		return
	}
	revision := strconv.FormatUint(room.Version, 10) + "." + strconv.FormatUint(room.roster, 10)
	if req.URL.Query().Get("since") == revision {
		res.WriteHeader(204)
		return
	}
	seats := make([]seatProgress, 0, len(room.People))
	for _, person := range room.People {
		if person.Seat < 1 {
			continue
		}
		frame := person.live
		if frame != nil && frame.Stage > 0 && !room.Open[frame.Stage-1] {
			frame = nil
		}
		seats = append(seats, progressFor(person, frame))
	}
	sort.Slice(seats, func(left, right int) bool { return seats[left].Seat < seats[right].Seat })
	jsonOut(res, 200, struct {
		Revision string         `json:"revision"`
		Seats    []seatProgress `json:"seats"`
	}{revision, seats})
}

func containsOnly(values, allowed []string) bool {
	for _, value := range values {
		found := false
		for _, candidate := range allowed {
			if value == candidate {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func itemIDs(items []item) []string {
	keys := make([]string, 0, len(items)+1)
	for _, entry := range items {
		keys = append(keys, entry.ID)
	}
	return keys
}

func validLive(stage int, draft liveDraft) bool {
	if len(draft.Values) > 12 || !unique(draft.Values) || (draft.Text != "" && !validText(draft.Text, 300, true)) ||
		(draft.Notice != "" && !validText(draft.Notice, 140, false)) {
		return false
	}
	validItem := func(items []item, key string) bool { return key == "" || find(items, key).ID != "" }
	switch stage {
	case 0:
		return true
	case 1:
		return validItem(drone, draft.Selected) && validItem(drone, draft.Focus) && containsOnly(draft.Values, itemIDs(drone)) && draft.Step >= -1 && draft.Step <= 6
	case 2:
		device := deviceByID(draft.Selected)
		return device != nil && validItem(device.Modules, draft.Focus) && validChoiceSlots(draft.Slots, device.SlotCount, device.Modules)
	case 3:
		return validItem(advantageOptions, draft.Focus) && validChoiceSlots(draft.Slots, advantageSlotCount, advantageOptions)
	case 4:
		lights := draft.Lights
		if lights == nil || len(lights.Direct) != len(lightPhases) ||
			(lights.Shared == nil && (len(draft.Values) != 0 || (lights.Mask != 0 && !validLightMask(lights.Mask)))) ||
			(lights.Shared != nil && (!lights.Shared.valid() || !validLightMask(lights.Mask))) ||
			draft.LightPick < 0 || draft.LightPick > len(lightPhases) ||
			(lights.Shared == nil && (draft.LightPick == 0) != (lights.Mask == 0)) || (lights.Shared != nil && draft.LightPick != 0) {
			return false
		}
		for _, setting := range lights.Direct {
			if !setting.valid() {
				return false
			}
		}
		return validItem(colors, draft.LightLamp) && (draft.Selected == "" || draft.Selected == "module") &&
			(draft.Mode == "" || draft.Mode == "old" || draft.Mode == "new") && draft.Preview >= -1 && draft.Preview <= len(lightPhases) &&
			containsOnly(draft.Values, lightCalls) && containsOnly([]string{draft.LightStep}, []string{"", "output", "wait", "off", "skip", "done"})
	case 5:
		if len(draft.Slots) != len(wiring) || !validItem(parts, draft.Selected) || !validItem(parts, draft.Focus) {
			return false
		}
		for index, part := range draft.Slots {
			if part != wiring[index] && (part != "" || draft.On) {
				return false
			}
		}
		return !draft.Playing || draft.On
	case 6:
		for _, id := range draft.Values {
			if !isRetrofit(id) {
				return false
			}
		}
		return draft.Step >= 0 && (len(draft.Values) > 0 || !draft.Playing)
	}
	return false
}

func (app *server) publishFrame(res http.ResponseWriter, req *http.Request, room *classroom, person *participant) {
	var frame liveFrame
	if !decode(res, req, &frame) {
		return
	}
	if !validLive(frame.Stage, frame.Draft) {
		reject(res, 400, "无法同步这一步操作。")
		return
	}
	if frame.Stage != 0 && !room.Open[frame.Stage-1] {
		reject(res, 423, "活动暂未开放。")
		return
	}
	now := time.Now().UTC()
	if person.live != nil && now.Sub(person.live.At) < 90*time.Millisecond {
		res.WriteHeader(429)
		return
	}
	app.frames++
	frame.Revision, frame.At = app.frames, now
	if progressFor(person, person.live) != progressFor(person, &frame) {
		room.roster++
	}
	person.live = &frame
	res.WriteHeader(204)
}

func (app *server) watchFrame(res http.ResponseWriter, req *http.Request, room *classroom) {
	if room.Code != app.active {
		reject(res, 410, "这堂课已结束。")
		return
	}
	seat, err := strconv.Atoi(req.URL.Query().Get("seat"))
	if err != nil || seat < 1 {
		reject(res, 400, "请选择学生。")
		return
	}
	for _, person := range room.People {
		if person.Seat != seat {
			continue
		}
		if person.live == nil || person.live.Stage == 0 || !room.Open[person.live.Stage-1] {
			jsonOut(res, 200, struct{}{})
			return
		}
		frame := person.live
		if req.URL.Query().Get("since") == strconv.FormatUint(frame.Revision, 10) {
			res.WriteHeader(204)
			return
		}
		var content any
		if req.URL.Query().Get("catalog") != strconv.Itoa(frame.Stage) {
			content = catalog[frame.Stage-1]
		}
		jsonOut(res, 200, struct {
			*liveFrame
			Content any  `json:"content,omitempty"`
			Done    bool `json:"done"`
		}{frame, content, currentAnswer(frame.Stage-1, person.Answers[frame.Stage-1]) != nil})
		return
	}
	reject(res, 404, "这位学生还未加入课堂。")
}
