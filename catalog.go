package main

import "slices"

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

var stageNames = [stageCount]string{"拆解无人机", "生活搜寻", "小组研究", "彩灯编程", "电脑组装", "校园安全卫士"}

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

var researchCorrect = [][]string{
	{"heat", "massage", "music"}, {"lens", "mobile", "screen"}, {"heater", "sensor", "rice-control"}, {"drive", "brake", "lights"}, {"wheels", "clean", "avoid"},
}

var colors = []item{{"blue", "蓝色", "", ""}, {"amber", "橙色", "", ""}, {"green", "绿色", "", ""}, {"purple", "紫色", "", ""}}

var ports = []item{
	{"atx", "24 针供电接口", "给主板供电。", ""},
	{"dimm", "内存插槽", "保存程序运行时暂用的数据。", ""},
	{"sata", "SATA 数据接口", "让主板和硬盘传输数据。", ""},
	{"hdmi", "HDMI 接口", "把图像送到显示器。", ""},
	{"usb", "USB 接口", "接收键盘输入。", ""},
}

var parts = []item{
	{"screen", "显示器", "HDMI 插头", "monitor"}, {"psu", "电源", "24 针电源线", "psu"}, {"keyboard", "键盘", "USB 插头", "keyboard"}, {"ram", "内存条", "带防呆缺口的金手指", "ram"}, {"disk", "硬盘", "SATA 数据和供电线", "disk"},
}

var wiring = []string{"psu", "ram", "disk", "screen", "keyboard"}

var jobs = []item{
	{"hall", "走廊巡逻", "在走廊发现障碍物，并提醒同学慢走。", ""},
	{"gate", "校门引导", "放学时提示排队，必要时通知值班老师。", ""},
	{"playground", "操场提醒", "发现拥挤或需要帮助时，让同学和老师及时知道。", ""},
}

var robotModules = []item{
	{"drive", "行走驱动", "让机器人前进、转向。", "track-drive"}, {"avoid", "红外避障", "发现前方障碍。", "infrared"}, {"voice", "语音播报", "说出提醒。", "speaker"}, {"warning", "灯光警示", "用亮灯提醒。", "beacon"}, {"track", "定位巡线", "沿路线巡逻。", "gps"}, {"chat", "无线通信", "向老师发送消息。", "radio"}, {"battery", "供电模块", "给各模块提供电能。", "battery"}, {"count", "人流检测", "估计通过的人数。", "chip"}, {"alarm", "一键报警", "按键后发出求助信号。", "alarm-button"},
}

type matchProject struct {
	project
	Pairs []item `json:"pairs"`
}

func matchingProjects() []matchProject {
	projects := make([]matchProject, 0, len(research))
	for index, entry := range research {
		pairs := make([]item, 0, len(researchCorrect[index]))
		for _, module := range entry.Modules {
			if slices.Contains(researchCorrect[index], module.ID) {
				pairs = append(pairs, module)
			}
		}
		projects = append(projects, matchProject{entry, pairs})
	}
	return projects
}

var catalog = [stageCount]any{
	map[string]any{"items": drone, "sequence": []string{"battery", "radio", "gps", "control", "power", "camera"}},
	map[string]any{"items": cases},
	map[string]any{"projects": matchingProjects()},
	map[string]any{"colors": colors, "calls": []string{"起飞前", "航拍中", "降落后"}},
	map[string]any{"ports": ports, "parts": parts},
	map[string]any{"jobs": jobs, "modules": robotModules},
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

func validate(idx int, values []string, text string) string {
	if len(values) > 12 || (text != "" && !validText(text, 300, true)) {
		return "请检查选择，记录最多 300 字。"
	}
	if idx != 2 && idx != 3 && idx != 5 && text != "" {
		return "此活动不需要填写记录。"
	}
	switch idx {
	case 0:
		if !match(values, []string{"power", "control", "camera", "gps", "radio", "battery", "flight"}) {
			return "装好六个模块，并完成一次联动试飞。"
		}
	case 1:
		if len(values) < 3 || !unique(values) {
			return "请找出至少三个模块化案例。"
		}
		for _, value := range values {
			if find(cases[:6], value).ID == "" {
				return "这里有不是模块化系统的例子，再想一想。"
			}
		}
	case 2:
		if len(values) > 0 {
			for projectIdx, project := range research {
				if project.ID == values[0] && match(values[1:], researchCorrect[projectIdx]) {
					return ""
				}
			}
		}
		return "请连对三个模块与作用，完成说明卡。"
	case 3:
		if len(values) != 4 || find(colors[1:], values[0]).ID == "" || !slices.Equal(values[1:], []string{"call-1", "call-2", "call-3"}) || text == "" {
			return "请完成三处模块调用，换一种颜色，写下你的发现。"
		}
	case 4:
		if !slices.Equal(values, wiring) {
			return "还有接口没有接对，检查后再开机。"
		}
	case 5:
		if len(values) < 3 || !unique(values) || find(jobs, values[0]).ID == "" || text == "" {
			return "请选择一个岗位和至少两个模块，再说明它们如何配合。"
		}
		for _, value := range values[1:] {
			if find(robotModules, value).ID == "" {
				return "请从清单选择模块。"
			}
		}
	}
	return ""
}

func displayValues(idx int, values []string) []string {
	labels := make([]string, 0, len(values))
	for pos, value := range values {
		var label string
		switch idx {
		case 0:
			label = find(drone, value).Name
			if value == "flight" {
				label = "已观察联动"
			}
		case 1:
			label = find(cases, value).Name
		case 2:
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
			label = find(colors, value).Name
			if value == "call-1" {
				label = "起飞前调用"
			} else if value == "call-2" {
				label = "航拍中调用"
			} else if value == "call-3" {
				label = "降落后调用"
			}
		case 4:
			if pos < len(ports) {
				label = find(parts, value).Name + " → " + ports[pos].Name
			}
		case 5:
			label = find(jobs, value).Name
			if pos > 0 {
				label = find(robotModules, value).Name
			}
		}
		if label != "" {
			labels = append(labels, label)
		}
	}
	return labels
}
