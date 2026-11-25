package main

import (
	"net/http"
	"strconv"
)

type learningEvidence uint8

const (
	learningNone learningEvidence = iota
	learningAttempt
	learningMilestone
)

func occupied(slots []string) int {
	count := 0
	for _, slot := range slots {
		if slot != "" {
			count++
		}
	}
	return count
}

func learningLevel(attempted, milestone bool) learningEvidence {
	if milestone {
		return learningMilestone
	}
	if attempted {
		return learningAttempt
	}
	return learningNone
}

func draftEvidence(frame liveFrame) learningEvidence {
	draft := frame.Draft
	switch frame.Stage {
	case 1:
		return learningLevel(len(draft.Values) > 0, draft.Flight && len(draft.Values) == len(drone))
	case 2:
		filled := occupied(draft.Slots)
		return learningLevel(filled > 0, filled == len(draft.Slots))
	case 3:
		filled := occupied(draft.Slots)
		return learningLevel(filled > 0, filled >= 2)
	case 4:
		lights := draft.Lights
		if lights.Shared != nil {
			return learningMilestone
		}
		if draft.Playing || draft.LightStep == "done" || lights.Mask != 0 {
			return learningAttempt
		}
		for _, settings := range lights.Direct {
			if settings != (lightSetting{"blue", 500, true}) {
				return learningAttempt
			}
		}
	case 5:
		return learningLevel(occupied(draft.Slots) > 0, draft.On && !draft.Playing)
	case 6:
		return learningLevel(len(draft.Values) > 0, len(draft.Values) >= 2)
	}
	return learningNone
}

func submittedEvidence(index int, values []string) learningEvidence {
	switch index {
	case 1:
		return learningLevel(true, occupied(values[1:]) == len(values)-1)
	case 2:
		return learningLevel(true, occupied(values) >= 2)
	case 5:
		return learningLevel(true, len(values) >= 2)
	default:
		return learningMilestone
	}
}

func (room *classroom) recordLearning(person *participant, index int, evidence learningEvidence) {
	if evidence > person.learning[index] {
		person.learning[index] = evidence
		room.learningRevision++
	}
}

type learningRate struct {
	Attempted float64 `json:"attempted"`
	Submitted float64 `json:"submitted"`
	Milestone float64 `json:"milestone"`
}

type learningSummary struct {
	Revision     string                   `json:"revision"`
	Active       bool                     `json:"active"`
	HasStudents  bool                     `json:"hasStudents"`
	Overall      learningRate             `json:"overall"`
	Stages       [stageCount]learningRate `json:"stages"`
	Distribution [stageCount + 1]float64  `json:"distribution"`
	Computer     computerProgress         `json:"computer"`
}

type computerProgress struct {
	Booted    int `json:"booted"`
	Submitted int `json:"submitted"`
}

func summarizeLearning(room *classroom) learningSummary {
	var summary learningSummary
	for _, person := range room.People {
		attempted, submitted, milestones := 0, 0, 0
		for index, evidence := range person.learning {
			rate := &summary.Stages[index]
			if answer := currentAnswer(index, person.Answers[index]); answer != nil && len(answer.Values) > 0 {
				rate.Submitted++
				submitted++
				evidence = max(evidence, submittedEvidence(index, answer.Values))
			}
			if evidence >= learningAttempt {
				rate.Attempted++
				attempted++
			}
			if evidence == learningMilestone {
				rate.Milestone++
				milestones++
			}
		}
		summary.Distribution[attempted]++
		if attempted > 0 {
			summary.Overall.Attempted++
		}
		if submitted > 0 {
			summary.Overall.Submitted++
		}
		if milestones > 0 {
			summary.Overall.Milestone++
		}
	}
	computer := summary.Stages[4]
	summary.Computer = computerProgress{Booted: int(computer.Milestone), Submitted: int(computer.Submitted)}
	if enrolled := len(room.People); enrolled > 0 {
		summary.HasStudents = true
		percentage := func(count float64) float64 { return count * 100 / float64(enrolled) }
		summary.Overall = learningRate{percentage(summary.Overall.Attempted), percentage(summary.Overall.Submitted), percentage(summary.Overall.Milestone)}
		for index, rate := range summary.Stages {
			summary.Stages[index] = learningRate{percentage(rate.Attempted), percentage(rate.Submitted), percentage(rate.Milestone)}
		}
		for index, count := range summary.Distribution {
			summary.Distribution[index] = percentage(count)
		}
	}
	return summary
}

func (app *server) learningStats(res http.ResponseWriter, req *http.Request, room *classroom) {
	active := room.Code == app.active
	revision := strconv.FormatUint(room.Version, 10) + "." + strconv.FormatUint(room.learningRevision, 10) + "." + strconv.FormatBool(active)
	if req.URL.Query().Get("since") == revision {
		res.WriteHeader(204)
		return
	}
	summary := summarizeLearning(room)
	summary.Active = active
	summary.Revision = revision
	jsonOut(res, 200, summary)
}
