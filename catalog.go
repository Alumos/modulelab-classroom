package main

import (
	"slices"
	"strconv"
	"strings"
)

type item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Info string `json:"info,omitempty"`
	Art  string `json:"art,omitempty"`
}

type project struct {
	item
	Group   string `json:"group"`
	Modules []item `json:"modules"`
}

var stageNames = [stageCount]string{"探解无人机模块", "分析身边的模块", "探寻模块化优势", "我来模块化实践", "我是模块组装师", "无人机改造畅想"}

var drone = []item{
	{"power", "动力模块", "电机带动螺旋桨，产生升力，也能改变飞行方向。", "propeller"},
	{"control", "飞控模块", "读取遥控指令和定位数据，协调电机，让无人机飞稳。", "chip"},
	{"camera", "航拍模块", "云台减小机身晃动，摄像头记录画面。", "camera"},
	{"gps", "定位模块", "接收卫星信号，告诉飞控无人机的位置。", "gps"},
	{"radio", "通信模块", "接收遥控指令，并把飞行状态或画面传回。", "radio"},
	{"battery", "电池模块", "给电机、芯片和摄像头供电。", "battery"},
}

var cases = []item{
	{"desktop", "台式电脑", "主机里的存储、电源等各有功能，坏了可以单独更换。", "computer"},
	{"phone", "智能手机", "屏幕组件、摄像头组件等各有工作，可由维修人员分别检测。", "phone"},
	{"bike", "共享单车", "智能锁包含锁控、定位和通信等功能模块。", "bike"},
	{"speaker", "蓝牙音箱", "蓝牙接收、声音播放和供电分别由不同模块负责。", "speaker"},
	{"robot-vac", "扫地机器人", "行走、吸尘、避障模块配合，机器才会自己打扫。", "vacuum"},
	{"furniture", "拼装家具", "柜体、门板、抽屉各有用途，通过统一的连接方式组合。", "cabinet"},
	{"eraser", "一块普通橡皮", "这是一整块橡皮，切成几块仍然只做同一件事，没有独立配合的不同模块。", "eraser"},
	{"cup", "一体成型的水杯", "这个例子没有可分拆配合的功能单元，一体成型的杯身本身不是模块化系统。", "cup"},
}

var research = []project{
	{item{"chair", "按摩椅", "它可以揉捏肩背、加热，还能播放蓝牙音乐。", "chair"}, "家居组", []item{
		{"heat", "加热模块", "让靠背升温。", ""}, {"stitch", "一根缝线", "固定面料的一小段线。", ""}, {"massage", "按摩驱动模块", "带动滚轮揉捏肩背。", ""}, {"music", "蓝牙音频模块", "接收并播放音乐。", ""},
	}},
	{item{"phone", "手机", "它可以显示并响应触摸、拍照、连接移动网络。", "phone"}, "数码组", []item{
		{"lens", "摄像模块", "采集图像。", ""}, {"mobile", "通信模块", "收发移动网络信号。", ""}, {"screw", "一颗螺丝", "起固定作用的通用零件。", ""}, {"screen", "触控显示模块", "显示画面并感应触摸。", ""},
	}},
	{item{"rice", "电饭锅", "它可以给锅加热、检测温度，并按程序煮饭。", "cooker"}, "家电组", []item{
		{"heater", "加热模块", "将电能转化为热能。", ""}, {"sensor", "温度检测模块", "检测锅内温度。", ""}, {"rice-control", "控制模块", "根据程序和温度控制加热。", ""}, {"label", "品牌贴纸", "标出设备品牌。", ""},
	}},
	{item{"car", "汽车", "它能够行驶、减速停车，也能用车灯提示其他人。", "car"}, "交通组", []item{
		{"paint", "车门的一点油漆", "保护这一小块表面。", ""}, {"drive", "动力模块", "提供车辆行驶所需的动力。", ""}, {"brake", "制动模块", "让车辆减速或停车。", ""}, {"lights", "照明信号模块", "照亮道路并发出转向等信号。", ""},
	}},
	{item{"vacuum", "扫地机器人", "它可以移动、吸走灰尘，还能避开障碍物。", "vacuum"}, "智能设备组", []item{
		{"wheels", "行走模块", "带动机器移动、转弯。", ""}, {"clean", "清扫模块", "扫起并吸走灰尘。", ""}, {"shell", "外壳的一角", "仅按外形圈出的一小块。", ""}, {"avoid", "避障模块", "检测前方障碍。", ""},
	}},
}

type deviceProject struct {
	item
	Modules   []item `json:"modules"`
	SlotCount int    `json:"slotCount"`
}

var devices = []deviceProject{
	{item{"device-chair", "按摩椅", "这台按摩椅能揉捏肩背、加热靠背，还能通过充放气挤压小腿。扶手上可以选择按摩程序，也能用蓝牙播放音乐。", "chair"},
		choices("heat:加热模块", "massage:揉捏驱动模块", "cool:冷风制冷模块", "music:蓝牙音频模块", "stitch:一根缝线", "air:气囊按摩模块", "panel:按键控制模块", "water:净水过滤模块"),
		5},
	{item{"device-phone", "智能手机", "这部手机可以显示画面并响应触摸，能拍照、通过移动网络通话和上网，也能播放声音、导航。它充好电后可以带出门使用。", "phone"},
		choices("projector:投影模块", "lens:摄像模块", "mobile:移动通信模块", "screen:触控显示模块", "batt:电池模块", "screw:一颗螺丝", "audio:音频模块", "location:卫星定位模块", "heat:加热模块"),
		6},
	{item{"device-rice", "智能电饭锅", "这台电饭锅能给米饭加热，并持续检测锅里的温度。可以按键选择煮饭或保温程序，屏幕会显示剩余时间。", "cooker"},
		choices("heater:加热模块", "sensor:温度检测模块", "lens:摄像模块", "program:程序控制模块", "tag:品牌贴纸", "keys:按键输入模块", "display:时间显示模块", "location:卫星定位模块"),
		5},
	{item{"device-car", "电动汽车", "这辆电动汽车可以前进、转弯、刹车，能用车灯照明和提示转向。电池为车辆供电，空调能调节车内温度。", "car"},
		choices("paint:车门油漆", "drive:电机驱动模块", "brake:制动模块", "stereo:蓝牙音响模块", "lights:照明信号模块", "steer:转向模块", "battery:动力电池模块", "ac:空调模块", "clean:吸尘模块"),
		6},
	{item{"device-vacuum", "扫地机器人", "这台扫地机器人会沿路线移动，先用刷子扫起灰尘，再把灰尘吸进尘盒。它遇到障碍会绕开，还会定位并找到充电座。", "vacuum"},
		choices("air:空气加湿模块", "wheels:行走模块", "brush:滚刷清扫模块", "shell:外壳的一角", "suction:吸尘模块", "avoid:避障模块", "charge:充电模块", "location:定位导航模块", "heat:加热模块"),
		6},
}

func choices(entries ...string) []item {
	items := make([]item, 0, len(entries))
	for _, entry := range entries {
		id, name, _ := strings.Cut(entry, ":")
		items = append(items, item{ID: id, Name: name})
	}
	return items
}

func deviceByID(id string) *deviceProject {
	for index := range devices {
		if devices[index].ID == id {
			return &devices[index]
		}
	}
	return nil
}

var advantageQuestions = []string{
	"无人机桨叶坏了，需要更换整机吗？",
	"生产 10000 台无人机，它的产线流程是怎样的？",
	"假如要提高摄像头的分辨率，该怎么升级？",
}

var advantageOptions = choices("whole:坏了就要整机更换", "combine:灵活组合", "parallel:并行开发", "cost:一定更便宜", "reuse:重复使用", "repair:维护扩展", "untested:装好就不用测试", "unit-test:单独测试", "any-fit:任意部件都能互换")

const advantageSlotCount = 5

var colors = []item{{"blue", "蓝色", "", ""}, {"amber", "橙色", "", ""}, {"green", "绿色", "", ""}, {"purple", "紫色", "", ""}, {"red", "红色", "", ""}}
var lightPhases = []string{"起飞前", "航拍中", "左转", "右转", "降落后"}
var lightCalls = []string{"call-1", "call-2", "call-3", "call-4", "call-5"}
var legacyLightPhases = []string{"起飞前", "航拍中", "降落后"}

const allLightBlocks = 7

func validLightMask(mask int) bool { return mask > 0 && mask <= allLightBlocks }

type lightSetting struct {
	Color    string `json:"color"`
	Duration int    `json:"duration"`
	Enabled  bool   `json:"enabled"`
}

func (setting lightSetting) valid() bool {
	return find(colors, setting.Color).ID != "" && setting.Duration >= 500 && setting.Duration <= 2000 && setting.Duration%500 == 0
}

func parseLightSetting(value string) (lightSetting, bool) {
	fields := strings.Split(value, ":")
	if len(fields) != 3 || (fields[2] != "on" && fields[2] != "off") {
		return lightSetting{}, false
	}
	duration, err := strconv.Atoi(fields[1])
	setting := lightSetting{fields[0], duration, fields[2] == "on"}
	return setting, err == nil && setting.valid()
}

var parts = []item{
	{"psu", "电源", "给主板和硬盘等部件供电。", ""},
	{"ram", "内存条", "临时保存运行中的程序和数据。", ""},
	{"disk", "硬盘", "关机后仍能保存文件。", ""},
	{"gpu", "显卡", "接入 PCIe 插槽，处理并输出画面。", ""},
	{"screen", "显示器", "接收并显示显卡输出的画面。", ""},
	{"keyboard", "键盘", "通过 USB 把按键输入送给电脑。", ""},
	{"mouse", "鼠标", "通过 USB 传送移动、点击和滚动操作。", ""},
	{"sata-wire", "SATA 数据线", "连接主板和硬盘，传输数据。", ""},
	{"hdmi-wire", "HDMI 线", "连接显卡和显示器，传输画面。", ""},
}

var wiring = itemIDs(parts)
var partSeats = []string{"电源仓", "内存插槽", "硬盘托架", "PCIe 插槽", "显示器底座位", "键盘接驳位", "鼠标接驳位", "硬盘 SATA 数据接口", "显卡 HDMI 接口"}
var legacyWiring = []string{"psu", "ram", "disk", "screen", "keyboard"}
var legacyPortNames = []string{"24 针供电接口", "内存插槽", "SATA 数据接口", "HDMI 接口", "USB 接口"}

type retrofitModule struct {
	item
	Task string `json:"task"`
}

var retrofitModules = []retrofitModule{
	{item{"wash", "清洗喷头", "喷头把水喷到外墙玻璃上，带走尘土。", "kit-wash"}, "高空洗窗"},
	{item{"grab", "抓取机械爪", "机械爪合拢夹住垃圾，把它提离山坡。", "kit-grab"}, "高山拾垃圾"},
	{item{"led", "彩灯灯条", "一排灯珠按顺序变色，组成彩灯表演。", "kit-led"}, "彩灯表演"},
	{item{"cargo", "运输挂钩", "挂钩连着吊带，能吊运茶叶和筐装农产品。", "kit-cargo"}, "运送茶叶"},
	{item{"mist", "植保喷洒器", "两侧喷头喷出细雾，覆盖下方的一片作物。", "kit-mist"}, "农田喷洒"},
	{item{"horn", "喊话喇叭", "喇叭放大语音，把提醒传给远处的人。", "kit-horn"}, "远程喊话"},
	{item{"drop", "物资投放舱", "舱门打开，食物包落到指定的接收区。", "kit-drop"}, "投放食物"},
	{item{"thermal", "热成像相机", "相机把温度差变成颜色，帮助找出夜间需要救援的人。", "kit-thermal"}, "夜间搜救"},
	{item{"beam", "探照灯", "探照灯把光集中到地面，让昏暗的道路清楚起来。", "kit-beam"}, "夜间照明"},
}

func isRetrofit(id string) bool {
	for _, module := range retrofitModules {
		if module.ID == id {
			return true
		}
	}
	return false
}

func legacyActivity(idx int, values []string) string {
	if len(values) == 0 {
		return ""
	}
	switch idx {
	case 1:
		if find(cases, values[0]).ID != "" {
			return "生活搜寻"
		}
	case 2:
		for _, entry := range research {
			if entry.ID == values[0] {
				return "小组研究"
			}
		}
	case 4:
		if slices.Equal(values, legacyWiring) {
			return "电脑组装"
		}
	case 5:
		if find(jobs, values[0]).ID != "" {
			return "校园安全卫士"
		}
	}
	return ""
}

func currentAnswer(idx int, answer *submission) *submission {
	if answer != nil && legacyActivity(idx, answer.Values) == "" {
		return answer
	}
	return nil
}

var jobs = []item{
	{"hall", "走廊巡逻", "在走廊发现障碍物，并提醒同学慢走。", ""},
	{"gate", "校门引导", "放学时提示排队，必要时通知值班老师。", ""},
	{"playground", "操场提醒", "发现拥挤或需要帮助时，让同学和老师及时知道。", ""},
}

var robotModules = []item{
	{"drive", "行走驱动", "让机器人前进、转向。", "track-drive"}, {"avoid", "红外避障", "发现前方障碍。", "infrared"}, {"voice", "语音播报", "说出提醒。", "speaker"}, {"warning", "灯光警示", "用亮灯提醒。", "beacon"}, {"track", "定位巡线", "沿路线巡逻。", "gps"}, {"chat", "无线通信", "向老师发送消息。", "radio"}, {"battery", "供电模块", "给各模块提供电能。", "battery"}, {"count", "人流检测", "估计通过的人数。", "chip"}, {"alarm", "一键报警", "按键后发出求助信号。", "alarm-button"},
}

var catalog = [stageCount]any{
	map[string]any{"items": drone, "sequence": []string{"battery", "radio", "gps", "control", "power", "camera"}},
	map[string]any{"projects": devices},
	map[string]any{"questions": advantageQuestions, "options": advantageOptions, "slotCount": advantageSlotCount},
	map[string]any{"colors": colors, "calls": lightPhases},
	map[string]any{"parts": parts, "wiring": wiring, "seats": partSeats},
	map[string]any{"modules": retrofitModules},
}

func find(items []item, id string) item {
	for _, entry := range items {
		if entry.ID == id {
			return entry
		}
	}
	return item{}
}

func unique(values []string) bool {
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

func match(values, allowed []string) bool {
	if len(values) != len(allowed) || !unique(values) {
		return false
	}
	for _, value := range values {
		if !slices.Contains(allowed, value) {
			return false
		}
	}
	return true
}

func validChoiceSlots(slots []string, count int, options []item) bool {
	if len(slots) != count {
		return false
	}
	for index, id := range slots {
		if id != "" && (find(options, id).ID == "" || slices.Contains(slots[:index], id)) {
			return false
		}
	}
	return true
}

func validChoiceAnswer(slots []string, count int, options []item) bool {
	return validChoiceSlots(slots, count, options) && slices.ContainsFunc(slots, func(value string) bool { return value != "" })
}

func validate(idx int, values []string, text string) string {
	if len(values) > 12 || (text != "" && !validText(text, 300, true)) {
		return "请检查选择，记录最多 300 字。"
	}
	if idx != 3 && idx != 5 && text != "" {
		return "此活动不需要填写记录。"
	}
	switch idx {
	case 0:
		if !match(values, []string{"power", "control", "camera", "gps", "radio", "battery", "flight"}) {
			return "装好六个模块，并完成一次联动试飞。"
		}
	case 1:
		if len(values) > 0 {
			if device := deviceByID(values[0]); device != nil && validChoiceAnswer(values[1:], device.SlotCount, device.Modules) {
				return ""
			}
		}
		return "请至少放入一张模块卡片再提交。"
	case 2:
		if !validChoiceAnswer(values, advantageSlotCount, advantageOptions) {
			return "请至少放入一张答案卡片再提交。"
		}
	case 3:
		if len(values) != 12 || !slices.Equal(values[:5], lightCalls) || strings.TrimSpace(text) == "" {
			return "请接好五处模块调用，写下你的发现。"
		}
		for _, value := range values[5:11] {
			if _, ok := parseLightSetting(value); !ok {
				return "请检查积木中的灯光设置。"
			}
		}
		if mask, err := strconv.Atoi(values[11]); err != nil || !validLightMask(mask) {
			return "请先选中要封装的积木。"
		}
	case 4:
		if !slices.Equal(values, wiring) {
			return "还有接口没有接对，检查后再开机。"
		}
	case 5:
		if len(values) == 0 || !unique(values) {
			return "请先加装至少一个模块。"
		}
		for _, value := range values {
			if !isRetrofit(value) {
				return "请从清单选择模块。"
			}
		}
	}
	return ""
}

func displayValues(idx int, values []string) []string {
	labels := make([]string, 0, len(values))
	legacy := legacyActivity(idx, values) != ""
	for pos, value := range values {
		var label string
		switch idx {
		case 0:
			label = find(drone, value).Name
			if value == "flight" {
				label = "已观察联动"
			}
		case 1:
			if legacy {
				label = find(cases, value).Name
			} else if device := deviceByID(values[0]); device != nil {
				label = find(device.Modules, value).Name
				if pos == 0 {
					label = device.Name
				}
			}
		case 2:
			if !legacy {
				label = find(advantageOptions, value).Name
				break
			}
			for _, project := range research {
				if project.ID == values[0] {
					if pos == 0 {
						label = project.Group + " / " + project.Name
					} else {
						label = find(project.Modules, value).Name
					}
					break
				}
			}
		case 3:
			if len(values) == 12 {
				switch {
				case pos < 5:
					label = lightPhases[pos] + "调用"
				case pos < 11:
					setting, _ := parseLightSetting(value)
					if pos < 10 {
						label = "独立 · " + lightPhases[pos-5] + "：" + lightSettingLabel(setting, allLightBlocks)
					} else {
						mask, _ := strconv.Atoi(values[11])
						label = "共用模块：" + lightSettingLabel(setting, mask)
					}
				}
			} else if pos == 0 && len(values) == 4 {
				label = find(colors, value).Name
			} else if pos >= 1 && pos <= 3 {
				label = legacyLightPhases[pos-1] + "调用"
			} else if setting, ok := parseLightSetting(value); ok && pos >= 4 && pos <= 7 {
				label = "共用模块"
				if pos < 7 {
					label = "独立 · " + legacyLightPhases[pos-4]
				}
				label += "：" + lightSettingLabel(setting, 3)
			}
		case 4:
			if legacy && pos < len(legacyPortNames) {
				label = find(parts, value).Name + " → " + legacyPortNames[pos]
			} else if pos < len(partSeats) {
				label = find(parts, value).Name + " → " + partSeats[pos]
			}
		case 5:
			if legacy {
				label = find(jobs, value).Name
				if pos > 0 {
					label = find(robotModules, value).Name
				}
			} else {
				for _, module := range retrofitModules {
					if module.ID == value {
						label = module.Name + " · " + module.Task
						break
					}
				}
			}
		}
		if label != "" {
			labels = append(labels, label)
		}
	}
	return labels
}

func lightSettingLabel(setting lightSetting, mask int) string {
	var labels []string
	if mask&1 != 0 {
		color := "不亮"
		if setting.Enabled {
			color = find(colors, setting.Color).Name
		}
		labels = append(labels, color)
	}
	if mask&2 != 0 {
		labels = append(labels, strconv.FormatFloat(float64(setting.Duration)/1000, 'f', -1, 64)+" 秒")
	}
	if mask&4 != 0 {
		labels = append(labels, "熄灭彩灯")
	}
	return strings.Join(labels, " · ")
}
