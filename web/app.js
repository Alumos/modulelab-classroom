(function () {
  'use strict';

  var root = document.getElementById('app');
  var stages = [
    ['拆解无人机', 'drone'], ['生活搜寻', 'computer'], ['小组研究', 'cooker'],
    ['彩灯编程', 'light'], ['电脑组装', 'board'], ['校园安全卫士', 'robot']
  ];
  var teacher = /^\/teacher\/?$/.test(location.pathname);
  var code = '';
  var device = '';
  var state = null;
  var rooms = [];
  var stage = -1;
  var content = null;
  var drafts = {};
  var clock;
  var refreshTimer;
  var roomSwitch = false;
  var generation = 0;
  var detailRequest = 0;
  var detailStage = 0;
  var projection = false;
  var submitting = false;
  var dragging = '';
  var hoverSlot;
  var touchGhost;
  var finger;
  var mouseFinger;
  var suppressClick = 0;
  var suppressPiece = '';
  var liveTimer;
  var liveBusy = false;
  var queuedFrame;
  var lastFrame = '';
  var watchTimer;
  var watchRun = 0;
  var watchSeat = '';
  var roster = {};
  var rosterVersion = '';
  var liveVersion = 0;
  var liveStage = 0;
  var liveContent;
  var paintedFrame = '';

  function id(name) { return document.getElementById(name); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character];
    });
  }

  function api(method, url, data, done) {
    var request = new XMLHttpRequest();
    request.open(method, url, true);
    request.timeout = 9000;
    if (method === 'POST') request.setRequestHeader('Content-Type', 'application/json');
    request.onload = function () {
      var result;
      if (request.responseText) {
        try { result = JSON.parse(request.responseText); } catch (error) { result = {}; }
      }
      done(request.status, result || {});
    };
    request.onerror = request.ontimeout = function () { done(0, {}); };
    request.send(method === 'POST' ? (typeof data === 'string' ? data : JSON.stringify(data)) : null);
  }

  function message(text, kind) {
    var node = id('message');
    if (!node) return;
    node.className = 'note ' + (kind || '');
    node.textContent = text || '';
  }

  function failed(data) { message(data.error || '暂时无法连接，请重试。', 'error'); }
  function svg(name, classes) {
    return '<svg class="art ' + (classes || '') + '" aria-hidden="true" focusable="false" ' +
      'viewBox="0 0 320 200"' + (classes === 'assembly-art' || classes === 'campus-art' ? ' preserveAspectRatio="none"' : '') +
      '><use xlink:href="/art.svg?v=5#' + esc(name) + '"></use></svg>';
  }

  function btn(text, action, classes, extra) {
    return '<button type="button" data-action="' + action + '" class="' + (classes || 'button') + '" ' + (extra || '') + '>' + text + '</button>';
  }

  function attr(name, value) { return 'data-' + name + '="' + esc(value) + '"'; }
  function pressed(value) { return ' aria-pressed="' + (value ? 'true' : 'false') + '"'; }
  function pad(number) { return number < 10 ? '0' + number : String(number); }
  function feedback() { return '<p id="message" class="note" role="status" aria-live="polite"></p>'; }

  function header(label, action) {
    return '<header class="top"><div class="top-inner"><a class="brand" href="' + (teacher ? '/teacher' : '/') + '">' + svg('brand') +
      '<span>模块化的应用</span></a><div class="top-right">' + (label ? '<span class="top-label">' + esc(label) + '</span>' : '') + (action || '') + '</div></div></header>';
  }

  function field(label, name, value, opts) {
    return '<label class="field" for="' + name + '"><span>' + label + '</span><input id="' + name + '" name="' + name +
      '" value="' + esc(value) + '" ' + opts + '></label>';
  }

  function textField(label, value, placeholder) {
    return '<label class="field memo" for="response"><span>' + label + '</span><textarea id="response" maxlength="300" rows="3" placeholder="' +
      esc(placeholder || '') + '">' + esc(value || '') + '</textarea></label>';
  }

  function stageTiles() {
    return '<ol class="route-map">' + stages.map(function (info, index) {
      return '<li><span class="map-num">' + pad(index + 1) + '</span>' + svg(info[1]) + '<b>' + info[0] + '</b></li>';
    }).join('') + '</ol>';
  }

  function access(error) {
    clearTimeout(refreshTimer);
    clearTimeout(clock);
    stopWatch();
    state = null;
    roomSwitch = false;
    content = null;
    drafts = {};
    root.innerHTML = header('', '') + '<main class="wrap entry"><div class="entry-grid"><section class="entry-copy">' +
      '<h1>' + (teacher ? '教师控制台' : '模块化的应用') + '</h1><form id="access" class="access-form">' +
      field('教师口令', 'password', '', 'type="password" autocomplete="current-password" required maxlength="256"') +
      '<button class="button primary" type="submit">' + (teacher ? '登录教师端' : '加入课堂') + '</button>' + feedback() +
      '</form></section><div class="blueprint entry-art">' + svg(teacher ? 'board' : 'drone', 'hero-art') +
      '<span class="axis axis-top"></span><span class="axis axis-bottom"></span></div></div>' + (!teacher ? stageTiles() : '') + '</main>';
    if (error) message(error, 'error');
  }

  function deviceKey() {
    if (device) return device;
    try { device = localStorage.getItem('modulelab-device') || ''; } catch (error) { }
    if (/^[0-9a-f]{64}$/.test(device)) return device;
    if (!window.crypto || !window.crypto.getRandomValues) return '';
    var bytes = window.crypto.getRandomValues(new Uint8Array(32));
    device = '';
    for (var index = 0; index < bytes.length; index++) device += ('0' + bytes[index].toString(16)).slice(-2);
    try {
      var existing = localStorage.getItem('modulelab-device') || '';
      if (/^[0-9a-f]{64}$/.test(existing)) device = existing;
      else localStorage.setItem('modulelab-device', device);
    } catch (error) { }
    return device;
  }

  function join() {
    clearTimeout(refreshTimer);
    clearTimeout(clock);
    cancelGrabs();
    clearTimeout(liveTimer);
    liveTimer = null;
    queuedFrame = null;
    lastFrame = '';
    if (state || !id('join-status')) {
      generation++;
      state = null;
      code = '';
      stage = -1;
      content = null;
      drafts = {};
      root.innerHTML = header('', '') + '<main class="wrap entry"><div class="entry-grid"><section class="entry-copy">' +
        '<h1 id="join-status" aria-live="polite">正在进入课堂</h1>' + feedback() + '</section><div class="blueprint entry-art">' + svg('drone') + '</div></div>' + stageTiles() + '</main>';
    }
    var key = deviceKey();
    if (!key) { id('join-status').textContent = '请更新浏览器'; return; }
    api('POST', '/api/student/current', {device: key}, function (status, data) {
      if (status !== 200 && status !== 201) {
        id('join-status').textContent = status === 404 ? '等待老师开启课堂' : (status === 409 ? '课堂座位已满' : '正在重新连接');
        message(status === 404 || status === 409 ? '' : '请保持本页打开。');
        refreshTimer = setTimeout(join, 3200 + Math.random() * 1700);
        return;
      }
      startStudent(data);
    });
  }

  function studentURL() { return '/api/student/' + code; }
  function roomURL() { return '/api/teacher/rooms/' + (state ? state.code : ''); }

  function startStudent(data) {
    state = data;
    code = data.code;
    if (location.search) {
      try { history.replaceState(null, '', '/'); } catch (error) { }
    }
    stage = -1;
    root.innerHTML = header(state.title, '<span class="alias">' + esc(state.name) + '</span>') + '<main class="wrap student-layout">' +
      '<nav id="activity-nav" class="activity-nav" aria-label="课堂活动"></nav><section id="stage" class="stage"></section></main>';
    var first = state.open.indexOf(true);
    if (first >= 0) loadStage(first, false);
    else { renderNav(); renderWaiting(); }
    schedule();
  }

  function renderNav() {
    if (!id('activity-nav')) return;
    id('activity-nav').innerHTML = '<ol>' + stages.map(function (info, index) {
      return '<li>' + btn('<span class="step-num">' + pad(index + 1) + '</span><span class="step-name">' + info[0] +
        '</span><span class="step-status">' + (state.done[index] ? '✓' : (!state.open[index] ? '<span class="lock" aria-label="未开放"></span>' : '›')) + '</span>',
      'navigate', 'nav-step' + (index === stage ? ' current' : '') + (state.open[index] ? '' : ' locked'),
      attr('index', index) + (index === stage ? ' aria-current="step"' : '') + (!state.open[index] ? ' disabled' : '') + (state.done[index] ? ' aria-label="' + info[0] + '，已提交"' : '')) + '</li>';
    }).join('') + '</ol>';
  }

  function renderWaiting() {
    id('stage').innerHTML = '<div class="stage-head"><h1 id="stage-title" tabindex="-1">等待老师开放活动</h1></div><div class="blueprint waiting-art">' + svg('drone', 'hero-art') + '</div>' + feedback();
    queueFrame();
  }

  function updateStudent(data) {
    if (!state || data.code !== code || data.version < state.version) return;
    var changed = state.open.join() !== data.open.join() || state.done.join() !== data.done.join();
    state = data;
    if (!changed) return;
    renderNav();
    if (stage >= 0 && !state.open[stage]) {
      clearTimeout(clock);
      cancelGrabs();
      dragging = '';
      lastFrame = '';
      if (drafts[stage]) drafts[stage].playing = false;
      stage = -1;
      generation++;
      content = null;
      renderNav();
      renderWaiting();
      if (state.open.indexOf(true) >= 0) loadStage(state.open.indexOf(true), false);
      else message('老师已关闭刚才的活动，已提交的记录仍会保留。');
    } else if (stage < 0 && state.open.indexOf(true) >= 0) loadStage(state.open.indexOf(true), false);
  }

  function schedule() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(poll, teacher ? 2200 : 2600 + Math.random() * 1600);
  }

  function poll() {
    if (!state) return;
    if (document.hidden || roomSwitch) { schedule(); return; }
    if (teacher && projection) { fetchSeats(); return; }
    var activeCode = state.code;
    api('GET', teacher ? roomURL() : studentURL() + '/status?since=' + state.version, null, function (status, data) {
      if (!state || state.code !== activeCode) return;
      if (status === 200) {
        if (teacher) updateRoom(data);
        else updateStudent(data);
      } else if (status === 401 || (!teacher && (status === 404 || status === 410))) {
        if (teacher) access(data.error);
        else join();
        return;
      }
      schedule();
    });
  }

  function queueFrame() {
    if (teacher || !state || (stage >= 0 && !content)) return;
    var payload = {stage: stage + 1, draft: stage >= 0 ? draft() : {}};
    var encoded = JSON.stringify(payload);
    if (encoded === lastFrame && !liveBusy) { queuedFrame = null; return; }
    queuedFrame = {room: code, encoded: encoded};
    if (!liveTimer && !liveBusy) liveTimer = setTimeout(sendFrame, 160);
  }

  function sendFrame() {
    liveTimer = null;
    var next = queuedFrame;
    queuedFrame = null;
    if (!next || !state || next.room !== code || next.encoded === lastFrame) return;
    liveBusy = true;
    api('POST', studentURL() + '/live', next.encoded, function (status) {
      liveBusy = false;
      if (code === next.room && status === 204) lastFrame = next.encoded;
      if (code === next.room && !queuedFrame && (status === 0 || status === 429 || status >= 500)) queuedFrame = next;
      if (queuedFrame && !liveTimer) liveTimer = setTimeout(sendFrame, status === 204 ? 160 : 650);
    });
  }

  function draft() { return drafts[stage]; }

  function newDraft(answer, index) {
    var values = answer ? answer.values : [];
    var saved = {values: values.slice(), text: answer ? answer.text || '' : '', selected: '', playing: false};
    if (index === 0) { saved.flight = values.indexOf('flight') >= 0; saved.values = values.filter(function (value) { return value !== 'flight'; }); saved.step = -1; }
    if (index === 1) saved.reveal = !!answer;
    if (index === 2 || index === 5) { saved.selected = values[0] || ''; saved.values = values.slice(1); }
    if (index === 3) { saved.color = values[0] || 'blue'; saved.values = values.slice(1); saved.preview = -1; }
    if (index === 4) { saved.slots = answer ? values.slice() : ['', '', '', '', '']; saved.on = !!answer; }
    return saved;
  }

  function title(index) {
    return '<div class="stage-head"><span class="activity-number">' + pad(index + 1) + '</span><h1 id="stage-title" tabindex="-1">' + stages[index][0] + '</h1>' +
      (state.done[index] ? '<span class="pill green">已提交</span>' : '') + '</div>';
  }

  function loadStage(next, focus) {
    if (!state.open[next]) return;
    clearTimeout(clock);
    if (draft()) draft().playing = false;
    lastFrame = '';
    queuedFrame = null;
    stage = next;
    content = null;
    dragging = '';
    cancelGrabs();
    var request = ++generation;
    renderNav();
    id('stage').innerHTML = title(next) + '<p class="instruction">正在打开活动…</p>' + feedback();
    api('GET', studentURL() + '/activity/' + (next + 1), null, function (status, data) {
      if (!state || request !== generation) return;
      if (status !== 200) {
        id('stage').innerHTML = title(next) + btn('重新打开', 'retry', 'button') + feedback();
        failed(data);
        if (status === 423 || status === 410) poll();
        return;
      }
      content = data.content;
      if (!drafts[next]) drafts[next] = newDraft(data.answer, next);
      renderStage(focus ? 'stage-title' : '');
    });
  }

  function find(items, value) {
    for (var index = 0; index < items.length; index++) if (items[index].id === value) return items[index];
    return null;
  }

  function has(value) { return draft().values.indexOf(value) >= 0; }
  function toggle(value) {
    var values = draft().values;
    var index = values.indexOf(value);
    if (index >= 0) values.splice(index, 1);
    else values.push(value);
  }

  function picked(info, action, isPicked, type, withArt, withInfo) {
    var marked = isPicked || type.indexOf('checked') >= 0;
    return btn((withArt ? svg(info.art) : '') + '<strong>' + esc(info.name) + '</strong>' +
      (withInfo ? '<span class="option-info">' + esc(info.info) + '</span>' : '') + '<span aria-hidden="true" class="check">' + (marked ? '✓' : '+') + '</span>',
    action, 'option ' + type + (isPicked ? ' picked' : ''), 'id="pick-' + esc(info.id) + '" ' + attr('value', info.id) + pressed(isPicked));
  }

  var fittings = {
    power: {size: [66, 26], positions: [[32, 34], [218, 34], [32, 135], [219, 135]], seat: '机臂电机座'},
    gps: {size: [30, 19], positions: [[145, 41]], seat: '定位天线座'},
    radio: {size: [54, 19], positions: [[133, 61]], seat: '通信接收器座'},
    control: {size: [48, 31], positions: [[136, 81]], seat: '飞控板螺丝座'},
    battery: {size: [52, 24], positions: [[134, 114]], seat: '电池滑轨'},
    camera: {size: [40, 25], positions: [[140, 141]], seat: '机头云台座'},
    psu: {size: [69, 31], positions: [[26, 134]], seat: '机箱电源仓'},
    ram: {size: [15, 61], positions: [[120, 56]], seat: '内存插槽'},
    disk: {size: [33, 54], positions: [[147, 91]], seat: '硬盘托架'},
    screen: {size: [106, 76], positions: [[202, 35]], seat: 'HDMI 显示器接驳位'},
    keyboard: {size: [101, 29], positions: [[205, 129]], seat: 'USB 键盘接驳位'}
  };

  function benchArt(part, variant) {
    var size = fittings[part].size;
    return '<svg class="bench-art bench-' + variant + '" viewBox="0 0 ' + size.join(' ') + '" aria-hidden="true" focusable="false"' +
      '><use xlink:href="/art.svg?v=5#' + variant + '-' + part + '" width="' + size[0] + '" height="' + size[1] + '"></use></svg>';
  }

  function stageOne() {
    var saved = draft();
    var active = find(content.items, saved.focus || saved.selected);
    return '<p class="instruction">把部件拖进形状相同的空槽，再试飞。</p>' + assemblyRack(content.items, saved.values) +
      '<div class="assembly-board drone-board' + (saved.playing ? ' flying' : '') + '">' + svg('drone-shadow', 'assembly-art') +
      '<div class="bench-device">' + svg('drone-frame', 'assembly-art') + (saved.playing ? svg('drone-flight-lights', 'assembly-art flight-lights') : '') +
      content.items.map(function (item) { return sockets(item, item.id, has(item.id)); }).join('') + '</div></div>' +
      assemblyReadout(active, saved.playing ? '螺旋桨转动，正在试飞' : saved.flight ? '试飞完成' : '等待安装', saved.values.length, 6,
      btn(saved.playing ? '飞行中…' : saved.flight ? '再次试飞' : '开始试飞', 'fly', 'button primary', 'id="fly"' + (saved.playing ? ' disabled' : '')) +
      btn('重新装配', 'reset', 'button secondary', 'id="reset"' + (saved.playing ? ' disabled' : '')));
  }

  function assemblyRack(items, placed) {
    return '<div class="bench-tray" aria-label="部件托盘">' + items.map(function (item) {
      var installed = placed.indexOf(item.id) >= 0;
      return btn('<span class="tray-illustration">' + benchArt(item.id, 'part') + '</span><strong>' + esc(item.name) + '</strong>' + (installed ? '<i aria-label="已装好">✓</i>' : ''), 'part',
        'tray-piece' + (installed ? ' installed' : '') + (draft().selected === item.id ? ' picked' : ''),
        'id="pick-' + item.id + '" ' + (!installed ? attr('piece', item.id) : '') + ' ' + attr('value', item.id) + pressed(draft().selected === item.id));
    }).join('') + '</div>';
  }

  function sockets(item, target, mounted) {
    var saved = draft();
    var part = item.id;
    var fit = fittings[part];
    var snapping = mounted && saved.focus === part && !saved.wrong && saved.notice === 'mounted';
    return fit.positions.map(function (point, index) {
      var label = (mounted ? item.name + '已装好' : fit.seat + '：空槽') + (index ? ' ' + (index + 1) : '');
      var drawing = benchArt(part, mounted ? 'part' : 'shape');
      if (mounted && part === 'screen' && saved.on) drawing += (saved.playing ? benchArt(part, 'display-start') : '') + benchArt(part, 'display');
      if (mounted && part === 'power') drawing = '<span class="rotor-spin' + (index === 1 || index === 2 ? ' reverse' : '') + '">' + drawing + '</span>';
      return btn(drawing, 'drop', 'bench-socket fitting-' + part + (mounted ? ' occupied' : '') + (snapping ? ' snapping' : ''),
        'id="slot-' + target + (index ? '-' + index : '') + '" ' + attr('drop', target) + ' ' + attr('fit', part) + ' ' + attr('mount-index', index) +
        (index ? ' tabindex="-1"' : '') + (mounted ? ' ' + attr('mounted', part) : '') + ' aria-label="' + esc(label) + '"');
    }).join('');
  }

  function fitBoard(panel) {
    Array.prototype.forEach.call(panel.querySelectorAll('.bench-socket'), function (socket) {
      var fit = fittings[socket.getAttribute('data-fit')];
      var point = fit.positions[Number(socket.getAttribute('data-mount-index'))];
      socket.style.left = point[0] / 3.2 + '%';
      socket.style.top = point[1] / 2 + '%';
      socket.style.width = fit.size[0] / 3.2 + '%';
      socket.style.height = fit.size[1] / 2 + '%';
    });
  }

  function assemblyReadout(active, fallback, count, total, controls) {
    var saved = draft();
    var label = saved.wrong && saved.notice ? '未装入' : active ? (saved.notice === 'mounted' ? '已装好：' : '') + active.name : fallback;
    var info = saved.wrong ? saved.notice : active ? active.info : '';
    if (stage === 4 && active && !saved.wrong) info = ['电源给主板供电，准备启动。', '内存临时保存运行中的程序和数据。', '通过数据线传输文件，通过供电线获得电力。', 'HDMI 把电脑画面送到显示器。', 'USB 把按键输入送给电脑。'][computerParts.indexOf(active.id)];
    return '<div class="bench-readout"><div class="bench-count"><strong>' + count + ' / ' + total + '</strong><span>已装好</span></div>' +
      '<div class="effect-bubble' + (saved.wrong ? ' bubble-error' : '') + (saved.notice === 'mounted' ? ' bubble-pop' : '') + '" aria-live="polite"><strong>' + esc(label) + '</strong>' +
      (info ? '<p>' + esc(info) + '</p>' : '') + '</div></div><div class="inline-actions bench-actions">' + controls + '</div>';
  }

  function stageTwo() {
    var saved = draft();
    var active = find(content.items, saved.selected);
    if (!saved.reveal) return '<div class="blueprint blank-stage">' + svg('computer', 'showcase') + svg('bike', 'showcase') + svg('vacuum', 'showcase') + '</div><div class="inline-actions">' + btn('打开案例箱', 'reveal', 'button primary') + '</div>';
    return '<p class="instruction">找出至少三个能拆成不同功能模块的例子。</p><div class="case-grid">' + content.items.map(function (info) {
      return picked(info, 'case', has(info.id), 'case-card', true, false);
    }).join('') + '</div><div class="readout"><div>' + (active ? '<b>' + esc(active.name) + '</b><span>' + esc(active.info) + '</span>' : '<b>已选 ' + saved.values.length + ' 项</b>') + '</div></div>';
  }

  function stageThree() {
    var saved = draft();
    var project = find(content.projects, saved.selected);
    return '<div class="group-bar"><div class="group-tabs" aria-label="研究小组">' + content.projects.map(function (info) {
      return btn(esc(info.group), 'project', 'button tab' + (saved.selected === info.id ? ' active' : ''), 'id="pick-' + info.id + '" ' + attr('value', info.id) + pressed(saved.selected === info.id));
    }).join('') + '</div>' + btn('抽一个', 'random', 'button secondary', 'id="random"') + '</div>' + (!project ?
      '<div class="blank-stage blueprint">' + content.projects.slice(0, 3).map(function (item) { return svg(item.art, 'showcase'); }).join('') + '</div>' :
      '<div class="research-product">' + svg(project.art) + '<div><h2>' + esc(project.name) + '</h2><p>' + esc(project.info) + '</p></div></div>' +
      '<p class="instruction">把模块连到它的作用，也可以依次点选两端。</p><div class="match-board" id="match-board"><svg class="match-wires" id="match-wires" aria-hidden="true"></svg>' +
      '<div class="match-list"><h3>模块名称</h3>' + project.pairs.map(function (item) {
        return btn(esc(item.name), 'pair-source', 'match-end source' + (has(item.id) ? ' linked' : '') + (saved.focus === item.id ? ' picked' : ''),
          'id="pick-' + item.id + '" ' + attr('value', item.id) + (has(item.id) ? ' disabled' : ' draggable="true" ' + attr('piece', item.id)) + pressed(saved.focus === item.id));
      }).join('') + '</div><div class="match-list"><h3>模块作用</h3>' + [1, 2, 0].map(function (index) {
        var item = project.pairs[index];
        return btn(esc(item.info), 'drop', 'match-end destination' + (has(item.id) ? ' linked' : ''), 'id="slot-' + item.id + '" ' + attr('drop', item.id) + (has(item.id) ? ' disabled' : ''));
      }).join('') + '</div></div><p class="local-feedback' + (saved.wrong ? ' error' : '') + '" aria-live="polite">' + esc(saved.notice || '') + '</p>' +
      '<section class="module-sheet"><div class="sheet-head"><h3>模块说明卡</h3><b>' + saved.values.length + ' / ' + project.pairs.length + '</b></div>' +
      '<dl>' + project.pairs.map(function (item) {
        return has(item.id) ? '<div class="sheet-entry"><dt>' + esc(item.name) + '</dt><dd>' + esc(item.info) + '</dd></div>' : '';
      }).join('') + '</dl>' + (saved.values.length === project.pairs.length ? '<p>这些模块各有一项功能；' +
        esc(project.modules.filter(function (item) { return !has(item.id); })[0].name) + '只是产品的一部分，不是独立的功能模块。</p>' : '') + '</section>' +
      textField('小组发现（选填）', saved.text, '这些模块如何配合？'));
  }

  function drawWires() {
    var board = id('match-board');
    if (!board) return;
    var frame = board.getBoundingClientRect();
    var wires = id('match-wires');
    wires.setAttribute('viewBox', '0 0 ' + frame.width + ' ' + frame.height);
    while (wires.firstChild) wires.removeChild(wires.firstChild);
    Array.prototype.forEach.call(board.querySelectorAll('.source.linked'), wire);
    function wire(node) {
      var target = id('slot-' + node.getAttribute('data-value'));
      var from = node.getBoundingClientRect();
      var to = target.getBoundingClientRect();
      var startX = from.right - frame.left;
      var startY = from.top + from.height / 2 - frame.top;
      var endX = to.left - frame.left;
      var endY = to.top + to.height / 2 - frame.top;
      var middle = (endX + startX) / 2;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + startX + ' ' + startY + 'C' + middle + ' ' + startY + ' ' + middle + ' ' + endY + ' ' + endX + ' ' + endY);
      wires.appendChild(path);
    }
  }

  function paintLights(mode) {
    var saved = draft();
    return '<div class="lamp-bank" aria-label="三段灯色预览">' + content.calls.map(function (label, index) {
      var color = mode === 'old' ? 'blue' : (has('call-' + (index + 1)) ? saved.color : 'off');
      var lit = color !== 'off' && saved.playing && saved.preview === index && saved.mode === mode;
      return '<div><i class="lamp lamp-' + color + (lit ? ' lamp-on' : '') + '" role="img" aria-label="' + (color === 'off' ? '没有调用' : esc(find(content.colors, color).name)) + '"></i><span>' + esc(label) + '</span></div>';
    }).join('') + '</div>';
  }

  function stageFour() {
    var saved = draft();
    var color = find(content.colors, saved.color).name;
    return '<p class="instruction">把「闪烁模块」拖到三个位置，也可以先点选再放入。</p><div class="code-work">' +
      '<section class="code-panel original"><h2>重复写法</h2><ol class="script">' + content.calls.map(function (label) {
        return '<li><b>' + esc(label) + '</b><code>亮蓝灯 → 等待 → 熄灭</code></li>';
      }).join('') + '</ol><div id="lights-old">' + paintLights('old') + '</div>' + btn('运行原程序', 'run', 'button secondary', 'id="run-old" data-value="old"' + (saved.playing ? ' disabled' : '')) + '</section>' +
      '<section class="code-panel refactor"><h2>模块写法</h2><div class="module-editor">' + btn('闪烁模块', 'part', 'code-block' + (saved.selected === 'module' ? ' picked' : ''),
        'id="pick-module" draggable="true" data-piece="module" data-value="module"' + pressed(saved.selected === 'module')) +
      '<label for="color">亮灯颜色</label><select id="color">' + content.colors.map(function (item) {
        return '<option value="' + item.id + '"' + (item.id === saved.color ? ' selected' : '') + '>' + item.name + '</option>';
      }).join('') + '</select></div><ol class="script">' + content.calls.map(function (label, index) {
        var place = 'call-' + (index + 1);
        return '<li><b>' + esc(label) + '</b>' + btn(has(place) ? '调用闪烁（' + color + '）' : '放入模块', 'drop', 'slot' + (has(place) ? ' filled' : ''), 'id="slot-' + place + '" ' + attr('drop', place)) + '</li>';
      }).join('') + '</ol><div id="lights-new">' + paintLights('new') + '</div>' + btn('运行模块程序', 'run', 'button secondary', 'id="run-new" data-value="new"' + (saved.playing ? ' disabled' : '')) + '</section></div>' +
      textField('只改一个模块，有什么变化？', saved.text, '先换一种灯色，再对比运行结果。');
  }

  var computerParts = ['psu', 'ram', 'disk', 'screen', 'keyboard'];

  function stageFive() {
    var saved = draft();
    var active = find(content.parts, saved.focus || saved.selected);
    return '<p class="instruction">把部件拖进对应空槽，再按电源开机。</p>' + assemblyRack(content.parts, saved.slots) +
      '<div class="assembly-board pc-board' + (saved.on ? ' booted' : '') + (saved.playing ? ' starting' : '') + '"><div class="bench-device">' +
      svg('pc-workbench', 'assembly-art') + svg('pc-fan', 'assembly-art cpu-fan') + (saved.on ? svg('pc-leds', 'assembly-art') : '') +
      computerParts.map(function (part, index) {
        return saved.slots[index] && part !== 'ram' ? svg('cable-' + part, 'assembly-art') : '';
      }).join('') + computerParts.map(function (part, index) {
        return sockets(find(content.parts, part), String(index), !!saved.slots[index]);
      }).join('') + '</div></div>' + assemblyReadout(active, saved.playing ? '风扇转动，正在开机' : saved.on ? '开机成功' : '等待安装', saved.slots.filter(Boolean).length, 5,
        btn(saved.playing ? '开机中…' : saved.on ? '已开机' : '按下电源', 'boot', 'button primary', 'id="boot"' + (saved.on ? ' disabled' : '')) +
        btn('拆下全部', 'reset', 'button secondary', 'id="reset"' + (saved.playing ? ' disabled' : '')));
  }

  function stageSix() {
    var saved = draft();
    var job = find(content.jobs, saved.selected);
    var active = find(content.modules, saved.focus);
    return '<div class="robot-studio"><section class="robot-side"><div class="robot-jobs" aria-label="巡逻岗位">' + content.jobs.map(function (info) {
      return btn(esc(info.name), 'job', 'button job-tab' + (job === info ? ' active' : ''), 'id="pick-' + info.id + '" ' + attr('value', info.id) + pressed(job === info));
    }).join('') + '</div><div class="robot-hangar' + (job ? ' job-' + job.id : '') + (has('warning') || has('alarm') ? ' robot-lit' : '') + '">' +
      svg(job && job.id !== 'gate' ? 'campus-' + job.id : 'campus', 'campus-art') + svg('robot-real', 'guard-art') + '<div class="robot-loadout">' + (saved.values.length ? saved.values.map(function (value) {
        return '<span class="pill">' + esc(find(content.modules, value).name) + '</span>';
      }).join('') : '<span>已装 0 个模块</span>') + '</div></div><p class="robot-brief">' + esc(job ? job.info : '给安全卫士选一个巡逻岗位。') + '</p></section>' +
      '<section class="robot-tools"><div class="sheet-head"><h2>选择模块</h2><b>' + saved.values.length + ' 个</b></div><div class="robot-kit">' +
      content.modules.map(function (info) { return picked(info, 'choose', has(info.id), 'kit-option', true, false); }).join('') +
      '</div><p class="robot-module-tip" aria-live="polite">' + (active ? '<b>' + esc(active.name) + '：</b>' + esc(active.info) : '点选模块查看作用。') + '</p></section></div>' +
      textField('设计方案：模块如何协同？', saved.text, '例如：避障模块发现障碍后，发信号让行走模块停下。');
  }

  function renderStage(focus) {
    if (!content || !state || stage < 0) return;
    var activities = [stageOne, stageTwo, stageThree, stageFour, stageFive, stageSix];
    id('stage').innerHTML = title(stage) + activities[stage]() + '<div class="stage-footer">' + btn(state.done[stage] ? '更新记录' : '提交记录', 'submit-stage', 'button primary',
      'id="submit-stage"' + (submitting || (stage === 1 && !draft().reveal) || ((stage === 0 || stage === 4) && draft().playing) ? ' disabled' : '')) + feedback() + '</div>';
    if (stage === 0 || stage === 4) fitBoard(id('stage'));
    if (focus && id(focus) && !id(focus).disabled && document.activeElement !== id(focus)) id(focus).focus();
    if (stage === 2) drawWires();
    queueFrame();
  }

  function submitStage() {
    if (submitting || !content) return;
    var saved = draft();
    var values = saved.values.slice();
    if (stage === 0 && saved.flight) values.push('flight');
    if (stage === 2 || stage === 5) values.unshift(saved.selected);
    if (stage === 3) values = [saved.color].concat(values.sort());
    if (stage === 4) {
      if (!saved.on) { message('请先接好部件并开机。', 'error'); return; }
      values = saved.slots;
    }
    submitting = true;
    id('submit-stage').disabled = true;
    message('正在保存…');
    var origin = generation;
    api('POST', studentURL() + '/activity/' + (stage + 1), {values: values, text: saved.text}, function (status, data) {
      submitting = false;
      if (id('submit-stage')) id('submit-stage').disabled = stage === 1 && !draft().reveal;
      if (status === 200) updateStudent(data);
    if (!state || origin !== generation) return;
      if (status === 200) { renderStage('submit-stage'); message('记录已交给老师。', 'success'); }
      else { failed(data); if (status === 423 || status === 410) poll(); }
    });
  }

  function playFlight() {
    var saved = draft();
    if (saved.playing) return;
    if (saved.values.length !== 6) { message('先把六个模块装到机身上。', 'error'); return; }
    saved.playing = true;
    saved.selected = '';
    saved.focus = '';
    saved.notice = '';
    saved.wrong = false;
    renderStage();
    clock = setTimeout(function () { saved.playing = false; saved.flight = true; renderStage('fly'); }, 4600);
  }

  function runLights(mode) {
    var saved = draft();
    if (saved.playing) return;
    saved.playing = true;
    saved.mode = mode;
    saved.preview = 0;
    id('run-old').disabled = id('run-new').disabled = true;
    function step() {
      id('lights-' + mode).innerHTML = paintLights(mode);
      queueFrame();
      clock = setTimeout(function () {
        saved.preview++;
        if (saved.preview < 3) step();
        else {
          saved.playing = false;
          id('lights-' + mode).innerHTML = paintLights(mode);
          id('run-old').disabled = id('run-new').disabled = false;
          queueFrame();
        }
      }, 780);
    }
    step();
  }

  function compatible(value, target) {
    if (stage === 0 || stage === 2) return value === target && !has(value);
    if (stage === 3) return value === 'module' && /^call-[123]$/.test(target) && !has(target);
    if (stage === 4) return computerParts[Number(target)] === value && !draft().slots[Number(target)];
    return false;
  }

  function place(value, target) {
    if (!content || !value) return;
    var saved = draft();
    if (!compatible(value, target)) {
      if (stage !== 0 && stage !== 2 && stage !== 4) return;
      saved.wrong = true;
      saved.notice = stage === 2 ? '作用没有对上，再连一次。' : stage === 4 ? '接头和这里的插槽不匹配，部件已回到托盘。' : '这里不是它的安装位，部件已回到托盘。';
      saved.focus = '';
      if (stage !== 2) saved.selected = '';
      renderStage('pick-' + value);
      var returned = id('pick-' + value);
      if (returned) returned.classList.add('returning');
      return;
    }
    saved.wrong = false;
    if (stage === 0) {
      saved.values.push(value);
      saved.focus = value;
      saved.notice = 'mounted';
      saved.selected = '';
    } else if (stage === 2) {
      saved.values.push(value);
      saved.focus = '';
      saved.notice = '连对了！说明卡已更新。';
    } else if (stage === 3) {
      saved.values.push(target);
      saved.selected = '';
    } else if (stage === 4) {
      saved.slots[Number(target)] = value;
      saved.selected = '';
      saved.on = false;
      saved.focus = value;
      saved.notice = 'mounted';
    } else return;
    renderStage('slot-' + target);
  }

  function bootComputer() {
    var saved = draft();
    if (saved.on) return;
    if (saved.slots.indexOf('') >= 0) { message('还有接口没接上。', 'error'); return; }
    if (saved.slots.join() !== computerParts.join()) { message('有接口接错了。对照部件的接头名称再试。', 'error'); return; }
    saved.on = true;
    saved.playing = true;
    saved.focus = '';
    saved.notice = '';
    saved.wrong = false;
    renderStage();
    clock = setTimeout(function () { saved.playing = false; renderStage('submit-stage'); }, 2100);
  }

  function dashboard() {
    root.innerHTML = header('教师端', btn('退出', 'logout', 'button quiet')) + '<main id="teacher-layout" class="wrap teacher-layout">' +
      '<div class="teacher-head"><h1>课堂控制台</h1><div class="teacher-menu"><label class="select-room" for="classrooms">课堂</label>' +
      '<select id="classrooms"' + (rooms.length ? '' : ' disabled') + '><option value="">选择课堂</option>' + rooms.map(function (room) {
        return '<option value="' + esc(room.code) + '"' + (state && state.code === room.code ? ' selected' : '') + '>' + esc(room.title) + '</option>';
      }).join('') + '</select>' + btn('新建课堂', 'show-create', 'button primary', 'id="new-room"') + '</div></div>' +
      '<form id="create-room" class="create-room"' + (rooms.length ? ' hidden' : '') + '>' +
      field('课堂名称', 'room-title', '', 'placeholder="例如：六年级一班" maxlength="32" required') + '<button type="submit" class="button primary">创建课堂</button></form>' +
      feedback() + '<div id="classroom"></div></main>';
    if (state) renderRoom();
  }

  function listRooms(preferred) {
    api('GET', '/api/teacher/rooms', null, function (status, data) {
      if (status !== 200) { access(status === 401 ? '' : (data.error || '无法读取课堂，请重试。')); return; }
      rooms = data;
      dashboard();
      if (!state && rooms.length) {
        var running = rooms.filter(function (room) { return room.active; })[0];
        switchRoom(preferred || (running || rooms[0]).code);
      }
      else if (state) schedule();
    });
  }

  function switchRoom(next) {
    if (!next) { if (state) id('classrooms').value = state.code; return; }
    var query = ++generation;
    roomSwitch = true;
    projection = false;
    stopWatch();
    api('GET', '/api/teacher/rooms/' + next, null, function (status, data) {
      if (query !== generation) return;
      roomSwitch = false;
      if (status === 401) { access(data.error); return; }
      if (status === 200) { state = data; detailStage = 0; renderRoom(); message(''); }
      else { id('classrooms').value = state ? state.code : ''; failed(data); }
      schedule();
    });
  }

  function createRoom(form) {
    var button = form.querySelector('button');
    if (button.disabled) return;
    var active = state ? state.current : '';
    if (active && !window.confirm('结束正在进行的课堂，开启下一堂课？原课堂记录会保留。')) return;
    button.disabled = true;
    api('POST', '/api/teacher/rooms', {title: id('room-title').value, replace: active}, function (status, data) {
      if (status === 401) { access(data.error); return; }
      if (status !== 201) {
        button.disabled = false;
        if (status === 409 && typeof data.active === 'string') {
          if (state) state.current = data.active;
          else { listRooms(data.active); return; }
        }
        failed(data);
        return;
      }
      detailStage = 0;
      generation++;
      roomSwitch = false;
      projection = false;
      watchSeat = '';
      stopWatch();
      state = data;
      rooms.unshift(data);
      dashboard();
      schedule();
    });
  }

  function shareURL() { return location.protocol + '//' + location.host + '/'; }

  function renderRoom() {
    id('teacher-layout').classList.remove('projecting');
    id('classrooms').value = state.code;
    id('classroom').innerHTML = '<section class="room-banner"><div><h2>' + esc(state.title) + '</h2><span class="room-state">' + (state.active ? '当前课堂' : '已结束') + '</span></div>' +
      (state.active ? '<div class="share-box"><label for="share">学生链接</label><div><input id="share" readonly value="' + esc(shareURL()) + '">' +
      btn('复制', 'copy', 'button share-button') + '</div></div>' : '') + '</section><section class="stats-strip" aria-label="课堂人数概况">' +
      '<div><span>已加入</span><strong id="enrolled"></strong><span>人</span></div><div><span>已开放</span><strong id="open-count"></strong><span> / 6</span></div>' +
      '<div><span>完成全部</span><strong id="complete"></strong><span>人</span></div></section><section class="teacher-progress"><div class="section-head"><h2>六个活动</h2><div>' +
      '<a class="button secondary teacher-only" href="' + roomURL() + '/export">导出 CSV</a></div></div><ol class="chart">' + stages.map(function (info, index) {
        return '<li><span class="chart-num">' + pad(index + 1) + '</span><b>' + info[0] + '</b><progress id="progress-' + index + '" aria-label="' + info[0] + '提交进度" max="1" value="0"></progress>' +
        '<span id="total-' + index + '" class="row-count"></span><span id="status-' + index + '" class="pill activity-state"></span>' +
        (state.active ? btn('', 'gate', 'button gate teacher-only', 'id="gate-' + index + '" ' + attr('index', index)) : '') + '</li>';
      }).join('') + '</ol></section><section class="teacher-results"><div class="section-head"><h2>学生记录</h2><select id="detail-stage" aria-label="查看活动记录">' + stages.map(function (info, index) {
        return '<option value="' + index + '"' + (detailStage === index ? ' selected' : '') + '>' + pad(index + 1) + ' ' + info[0] + '</option>';
      }).join('') + '</select></div><div id="result-list" class="result-list"></div></section>' +
      (state.active ? pager('1 / 2', '投屏展示 ›') : '');
    paintRoom();
    loadResults();
  }

  function paintRoom() {
    id('enrolled').textContent = state.enrolled;
    id('complete').textContent = state.complete;
    id('open-count').textContent = state.open.filter(function (open) { return open; }).length;
    stages.forEach(function (info, index) {
      id('progress-' + index).max = Math.max(state.enrolled, 1);
      id('progress-' + index).value = state.counts[index];
      id('total-' + index).textContent = state.counts[index] + ' / ' + state.enrolled;
      var status = id('status-' + index);
      var button = id('gate-' + index);
      status.className = 'pill activity-state' + (state.open[index] ? ' green' : '');
      status.textContent = state.open[index] ? '开放中' : '未开放';
      if (button) {
        button.textContent = state.open[index] ? '关闭' : '开放';
        button.setAttribute('aria-label', (state.open[index] ? '关闭' : '开放') + info[0]);
      }
    });
  }

  function updateRoom(data) {
    if (!state || data.code !== state.code || data.version < state.version) return;
    var activeChanged = data.active !== state.active;
    var changed = data.version !== state.version;
    state = data;
    if (activeChanged) { projection = false; stopWatch(); renderRoom(); message('这堂课已结束。'); }
    else if (!projection && changed) { paintRoom(); loadResults(); }
  }

  function loadResults() {
    var request = ++detailRequest;
    api('GET', roomURL() + '/results?stage=' + (detailStage + 1), null, function (status, data) {
      if (request !== detailRequest || !id('result-list')) return;
      if (status !== 200) { id('result-list').textContent = '暂时无法读取记录。'; return; }
      id('result-list').innerHTML = data.length ? data.map(function (item, index) {
        return '<article class="record"><h3>' + (projection ? '作品 ' + pad(index + 1) : esc(item.name)) + '</h3><div class="tags">' +
          item.values.map(function (value) { return '<span class="pill">' + esc(value) + '</span>'; }).join('') + '</div>' + (item.text ? '<p>' + esc(item.text) + '</p>' : '') + '</article>';
      }).join('') : '<p class="empty-results">还没有提交记录。</p>';
    });
  }

  function gate(button) {
    var index = Number(button.getAttribute('data-index'));
    var opening = !state.open[index];
    var activeCode = state.code;
    button.disabled = true;
    api('POST', roomURL() + '/activity/' + (index + 1), {open: opening}, function (status, data) {
      if (!state || activeCode !== state.code || !id('gate-' + index)) return;
      id('gate-' + index).disabled = false;
      if (status === 200) { updateRoom(data); message('「' + stages[index][0] + '」' + (opening ? '已开放。' : '已关闭。'), 'success'); }
      else if (status === 401) access(data.error);
      else failed(data);
    });
  }

  function copyLink() {
    var input = id('share');
    function fallback() {
      input.focus();
      input.select();
      try { if (document.execCommand('copy')) { message('已复制学生链接。', 'success'); return; } } catch (error) { }
      message('已选中链接，可手动复制。');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(function () { message('已复制学生链接。', 'success'); }, fallback);
    } else fallback();
  }

  function pager(page, label) {
    return '<div class="page-turn"><span>' + page + '</span>' + btn(label, 'projection', 'button primary', 'id="projection"') + '</div>';
  }

  function stopWatch() {
    clearTimeout(watchTimer);
    watchRun++;
    liveVersion = 0;
    liveStage = 0;
    liveContent = null;
    paintedFrame = '';
  }

  function seatCards() {
    var cards = '';
    for (var seat = 1; seat <= 50; seat++) {
      cards += btn('<strong>学生' + pad(seat) + '</strong><span class="seat-activity">未加入</span><span class="seat-progress"></span>', 'watch-seat', 'seat-card',
        'id="seat-' + seat + '" ' + attr('value', seat) + pressed(false) + ' disabled');
    }
    return cards;
  }

  function paintSeat(seat) {
    var entry = roster[seat];
    var activity = entry ? '等待活动' : '未加入';
    var progress = '';
    if (entry && entry.stage) {
      var count = entry.count || 0;
      activity = stages[entry.stage - 1][0];
      progress = ['已装 ' + count + ' / 6', '已选 ' + count + ' 项', '已连 ' + count + ' / 3',
        '已放 ' + count + ' / 3', '已装 ' + count + ' / 5', '已选 ' + count + ' 个模块'][entry.stage - 1];
      if (entry.done) progress += ' · 已提交';
      else if (entry.ready) progress = entry.stage === 1 ? '已试飞' : '已开机';
    }
    var card = id('seat-' + seat);
    var selected = String(seat) === watchSeat;
    var key = [activity, progress, selected].join('|');
    if (card.getAttribute('data-summary') === key) return;
    card.setAttribute('data-summary', key);
    card.setAttribute('aria-pressed', String(selected));
    card.className = 'seat-card' + (entry && entry.stage ? ' seat-working' : '') + (entry && entry.done ? ' seat-done' : '');
    card.disabled = !entry;
    card.children[1].textContent = activity;
    card.children[2].textContent = progress;
  }

  function fetchSeats() {
    clearTimeout(refreshTimer);
    var activeCode = state.code;
    var board = id('seat-grid');
    api('GET', roomURL() + '/live-seats?since=' + rosterVersion, null, function (status, data) {
      if (!projection || !state || state.code !== activeCode || id('seat-grid') !== board) return;
      if (status === 401) { access(data.error); return; }
      if (status === 410) {
        projection = false;
        stopWatch();
        renderRoom();
        poll();
        return;
      }
      if (status === 200) {
        rosterVersion = data.revision;
        roster = {};
        data.seats.forEach(function (entry) { roster[entry.seat] = entry; });
        for (var seat = 1; seat <= 50; seat++) paintSeat(seat);
        id('seat-count').textContent = data.seats.length + ' / 50 已加入';
      }
      schedule();
    });
  }

  function renderProjection() {
    stopWatch();
    watchSeat = '';
    rosterVersion = '';
    roster = {};
    id('teacher-layout').classList.add('projecting');
    id('classroom').innerHTML = '<section class="monitor-head"><div><h2>学生实时画面</h2><span>' + esc(state.title) + '</span></div><strong id="seat-count"></strong></section>' +
      '<div id="seat-grid" class="seat-grid" aria-label="学生座位与当前活动进度">' + seatCards() + '</div>' +
      '<section id="watch-panel" hidden><div class="watch-bar"><h2 id="watch-status" tabindex="-1"></h2>' + btn('关闭画面', 'close-watch', 'button secondary') + '</div>' +
      '<div id="stage" class="stage mirror-stage" aria-label="学生操作画面"></div></section>' + pager('2 / 2', '‹ 课堂控制');
    fetchSeats();
  }

  function monitorEmpty(text) {
    var panel = id('stage');
    if (panel && panel.getAttribute('data-empty') !== text) {
      paintedFrame = '';
      panel.setAttribute('data-empty', text);
      panel.innerHTML = '<div class="mirror-empty">' + svg('monitor') + '<p>' + esc(text) + '</p></div>';
    }
  }

  function watchStudent() {
    stopWatch();
    monitorEmpty(watchSeat ? '等待这位学生打开活动' : '选一位学生开始投屏');
    id('watch-status').textContent = watchSeat ? '学生' + pad(Number(watchSeat)) : state.title;
    if (watchSeat) fetchFrame(watchRun);
  }

  function fetchFrame(run) {
    if (!projection || !state || run !== watchRun) return;
    if (document.hidden) { watchTimer = setTimeout(function () { fetchFrame(run); }, 800); return; }
    api('GET', roomURL() + '/live?seat=' + watchSeat + '&since=' + liveVersion + '&catalog=' + liveStage, null, function (status, data) {
      if (!projection || run !== watchRun || !id('stage')) return;
      if (status === 401) { access(data.error); return; }
      if (status === 200 && data.stage) {
        liveVersion = data.revision;
        liveStage = data.stage;
        if (data.content) liveContent = data.content;
        if (liveContent) {
          paintFrame(data);
        }
      } else if (status === 200 || status === 404 || status === 410) {
        liveVersion = 0;
        monitorEmpty(status === 410 ? '这堂课已结束' : '等待这位学生打开活动');
      } else if (status !== 204) { liveVersion = 0; monitorEmpty('正在重新连接学生画面'); }
      watchTimer = setTimeout(function () { fetchFrame(run); }, status === 0 ? 1600 : 460);
    });
  }

  function paintFrame(frame) {
    var incoming = frame.draft;
    var mirrorText = incoming.text || '';
    incoming.text = '';
    var layoutKey = JSON.stringify([frame.stage, frame.done, incoming]);
    incoming.text = mirrorText;
    if (layoutKey === paintedFrame) {
      if (id('response') && id('response').value !== mirrorText) id('response').value = mirrorText;
      return;
    }
    paintedFrame = layoutKey;
    var previousStage = stage;
    var previousContent = content;
    var index = frame.stage - 1;
    var previousDraft = drafts[index];
    stage = index;
    content = liveContent;
    incoming.values = incoming.values || [];
    drafts[index] = incoming;
    var activities = [stageOne, stageTwo, stageThree, stageFour, stageFive, stageSix];
    var panel = id('stage');
    panel.removeAttribute('data-empty');
    panel.innerHTML = '<div class="stage-head"><span class="activity-number">' + pad(frame.stage) + '</span><h1>' + stages[index][0] + '</h1>' +
      (frame.done ? '<span class="pill green">已提交</span>' : '') + '</div>' + activities[index]();
    if (index === 0 || index === 4) fitBoard(panel);
    var controls = panel.querySelectorAll('button, textarea, select');
    Array.prototype.forEach.call(controls, function (control) { control.disabled = true; control.removeAttribute('draggable'); });
    if (index === 2) drawWires();
    if (previousDraft) drafts[index] = previousDraft;
    else delete drafts[index];
    stage = previousStage;
    content = previousContent;
  }

  var actions = {
    navigate: function (button) { loadStage(Number(button.getAttribute('data-index')), true); },
    retry: function () { loadStage(stage, true); },
    fly: playFlight,
    reveal: function () { draft().reveal = true; renderStage('pick-desktop'); },
    'case': function (button, value) { toggle(value); draft().selected = value; renderStage(button.id); },
    project: function (button, value) { if (draft().selected !== value) { drafts[stage] = newDraft(null, stage); draft().selected = value; } renderStage(button.id); },
    random: function () {
      var options = content.projects.filter(function (item) { return item.id !== draft().selected; });
      actions.project({id: 'random'}, options[Math.floor(Math.random() * options.length)].id);
    },
    choose: function (button, value) { toggle(value); draft().focus = value; renderStage(button.id); },
    'pair-source': function (button, value) { draft().focus = draft().focus === value ? '' : value; draft().notice = ''; draft().wrong = false; renderStage(button.id); },
    job: function (button, value) { draft().selected = value; renderStage(button.id); },
    run: function (button, value) { runLights(value); },
    part: function (button, value) {
      var saved = draft();
      if (saved.playing && (stage === 0 || stage === 4)) return;
      saved.focus = value;
      saved.notice = '';
      saved.wrong = false;
      saved.selected = button.classList.contains('installed') || saved.selected === value ? '' : value;
      renderStage(button.id);
    },
    drop: function (button) {
      if (draft().playing && (stage === 0 || stage === 4)) return;
      var value = stage === 2 ? draft().focus : draft().selected;
      if (!value && button.hasAttribute('data-mounted')) { draft().focus = button.getAttribute('data-mounted'); draft().wrong = false; draft().notice = ''; renderStage(button.id); return; }
      if (!value) { message(stage === 3 ? '先点「闪烁模块」，再点这里。' : stage === 2 ? '先点左边的模块名称。' : '先选一个部件，再点对应空槽。'); return; }
      place(value, button.getAttribute('data-drop'));
    },
    boot: bootComputer,
    reset: function () { drafts[stage] = newDraft(null, stage); renderStage('reset'); },
    'submit-stage': submitStage,
    logout: function () {
      api('POST', '/api/teacher/logout', {}, function (status, data) {
        if (status === 200 || status === 401) { generation++; projection = false; access(); }
        else failed(data);
      });
    },
    'show-create': function () { id('create-room').hidden = !id('create-room').hidden; if (!id('create-room').hidden) id('room-title').focus(); },
    copy: copyLink,
    gate: gate,
    'watch-seat': function (button, value) {
      var previous = watchSeat;
      watchSeat = value;
      if (previous) paintSeat(Number(previous));
      paintSeat(Number(watchSeat));
      id('watch-panel').hidden = false;
      if (previous !== value) watchStudent();
      id('watch-status').focus();
      id('watch-panel').scrollIntoView();
    },
    'close-watch': function () {
      var previous = watchSeat;
      watchSeat = '';
      stopWatch();
      id('watch-panel').hidden = true;
      id('stage').innerHTML = '';
      id('stage').removeAttribute('data-empty');
      paintSeat(Number(previous));
      id('seat-' + previous).focus();
    },
    projection: function () {
      projection = !projection;
      if (projection) renderProjection();
      else { stopWatch(); renderRoom(); poll(); }
      id('projection').focus();
    }
  };

  function ancestor(node, attribute) {
    while (node && node !== root) {
      if (node.getAttribute && node.hasAttribute(attribute)) return node;
      node = node.parentNode;
    }
    return null;
  }

  root.addEventListener('click', function (event) {
    var button = ancestor(event.target, 'data-action');
    if (!button || button.disabled) return;
    if (button.id === suppressPiece && event.detail && Date.now() < suppressClick) return;
    var action = actions[button.getAttribute('data-action')];
    if (action) action(button, button.getAttribute('data-value'));
  });

  root.addEventListener('input', function (event) { if (!teacher && event.target.id === 'response' && draft()) { draft().text = event.target.value; queueFrame(); } });
  root.addEventListener('change', function (event) {
    if (event.target.id === 'color') { draft().color = event.target.value; renderStage('color'); }
    if (event.target.id === 'classrooms') switchRoom(event.target.value);
    if (event.target.id === 'detail-stage') { detailStage = Number(event.target.value); loadResults(); }
  });

  root.addEventListener('submit', function (event) {
    var form = event.target;
    event.preventDefault();
    if (form.id === 'create-room') { createRoom(form); return; }
    if (form.id !== 'access') return;
    if (!teacher) return;
    var button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    api('POST', '/api/teacher/login', {password: form.elements.password.value}, function (status, data) {
      if (status === 200) listRooms();
      else { button.disabled = false; failed(data); }
    });
  });

  root.addEventListener('dragstart', function (event) {
    var piece = ancestor(event.target, 'data-piece');
    if (teacher || !piece || !event.dataTransfer) return;
    dragging = piece.getAttribute('data-piece');
    event.dataTransfer.setData('text/plain', dragging);
    event.dataTransfer.effectAllowed = 'move';
  });
  function showSlot(target, value) {
    if (hoverSlot === target) return;
    if (hoverSlot) markSlot(hoverSlot, false);
    hoverSlot = target;
    if (target && compatible(value, target.getAttribute('data-drop'))) markSlot(target, true);
  }
  function markSlot(slot, active) {
    var nodes = slot.getAttribute('data-fit') === 'power' ? slot.parentNode.querySelectorAll('.fitting-power') : [slot];
    Array.prototype.forEach.call(nodes, function (node) { if (active) node.classList.add('targeted'); else node.classList.remove('targeted'); });
  }
  root.addEventListener('dragend', function () {
    var target = hoverSlot;
    showSlot(null);
    if (target && dragging && content && !compatible(dragging, target.getAttribute('data-drop'))) place(dragging, target.getAttribute('data-drop'));
    dragging = '';
  });
  root.addEventListener('dragover', function (event) {
    if (!dragging || !content) return;
    var target = ancestor(event.target, 'data-drop');
    showSlot(target, dragging);
    if (target) {
      event.preventDefault();
      event.dataTransfer.dropEffect = compatible(dragging, target.getAttribute('data-drop')) ? 'move' : 'none';
    }
  });
  root.addEventListener('dragleave', function (event) {
    if (!hoverSlot || !dragging) return;
    var target = ancestor(event.target, 'data-drop');
    if (target === hoverSlot && event.relatedTarget && !target.contains(event.relatedTarget)) showSlot(null);
  });
  root.addEventListener('drop', function (event) {
    var target = ancestor(event.target, 'data-drop');
    if (target && dragging) { event.preventDefault(); place(dragging, target.getAttribute('data-drop')); }
    showSlot(null);
    dragging = '';
  });

  function grab(piece, point) {
    return {piece: piece, name: piece.getAttribute('data-piece'), x: point.clientX, y: point.clientY, assembly: piece.classList.contains('tray-piece')};
  }

  function moveGrab(current, point) {
    if (!current.moved && Math.abs(point.clientX - current.x) + Math.abs(point.clientY - current.y) < 8) return false;
    if (!current.moved) {
      var piece = current.piece;
      var target = current.assembly && id('stage').querySelector('.fitting-' + current.name);
      var source = current.assembly ? piece.querySelector('.bench-art') : piece;
      var size = (target || source).getBoundingClientRect();
      current.width = size.width;
      current.height = size.height;
      current.source = source;
      touchGhost = source.cloneNode(true);
      touchGhost.removeAttribute('id');
      touchGhost.removeAttribute('data-piece');
      touchGhost.classList.add('touch-ghost');
      if (current.assembly) touchGhost.classList.add('piece-ghost');
      touchGhost.setAttribute('aria-hidden', 'true');
      touchGhost.setAttribute('tabindex', '-1');
      touchGhost.style.width = current.width + 'px';
      touchGhost.style.height = current.height + 'px';
      document.body.appendChild(touchGhost);
      piece.classList.add('moving');
      current.moved = true;
    }
    current.target = ancestor(document.elementFromPoint(point.clientX, point.clientY), 'data-drop');
    touchGhost.style.transform = 'translate(' + (point.clientX - current.width / 2) + 'px,' + (point.clientY - current.height / 2) + 'px)';
    showSlot(current.target, current.name);
    return true;
  }

  function releaseGrab(current, cancelled) {
    if (!current || !current.moved) return;
    var target = !cancelled && document.documentElement.contains(current.piece) && current.target;
    var destination = target && target.getAttribute('data-drop');
    current.piece.classList.remove('moving');
    showSlot(null);
    releaseGhost(current, !cancelled && (!destination || !compatible(current.name, destination)));
    suppressPiece = current.piece.id;
    suppressClick = Date.now() + 250;
    if (destination) place(current.name, destination);
  }

  function cancelGrabs() {
    releaseGrab(mouseFinger, true);
    releaseGrab(finger, true);
    mouseFinger = finger = null;
    showSlot(null);
  }

  root.addEventListener('mousedown', function (event) {
    var piece = ancestor(event.target, 'data-piece');
    if (teacher || finger || event.button !== 0 || !piece || !piece.classList.contains('tray-piece')) return;
    mouseFinger = grab(piece, event);
  });
  window.addEventListener('mousemove', function (event) {
    if (!mouseFinger) return;
    if (!document.documentElement.contains(mouseFinger.piece)) { releaseGrab(mouseFinger, true); mouseFinger = null; return; }
    if (moveGrab(mouseFinger, event)) event.preventDefault();
  });
  window.addEventListener('mouseup', function () { releaseGrab(mouseFinger, false); mouseFinger = null; });
  window.addEventListener('blur', cancelGrabs);

  root.addEventListener('touchstart', function (event) {
    var piece = ancestor(event.target, 'data-piece');
    if (teacher || mouseFinger || !piece || event.touches.length !== 1) return;
    finger = grab(piece, event.touches[0]);
  });
  var touchOptions = false;
  try {
    var checkPassive = Object.defineProperty({}, 'passive', {get: function () { touchOptions = {passive: false}; }});
    var empty = function () {};
    window.addEventListener('test-passive', empty, checkPassive);
    window.removeEventListener('test-passive', empty, checkPassive);
  } catch (error) { }
  root.addEventListener('touchmove', function (event) {
    if (!finger || event.touches.length !== 1) return;
    if (!document.documentElement.contains(finger.piece)) { releaseGrab(finger, true); finger = null; return; }
    if (moveGrab(finger, event.touches[0]) && event.cancelable) event.preventDefault();
  }, touchOptions);
  function releaseGhost(current, returns) {
    if (!touchGhost) return;
    var ghost = touchGhost;
    touchGhost = null;
    if (!returns) { ghost.parentNode.removeChild(ghost); return; }
    var original = current.source.getBoundingClientRect();
    ghost.classList.add('ghost-return');
    ghost.style.transform = 'translate(' + (original.left + (original.width - current.width) / 2) + 'px,' + (original.top + (original.height - current.height) / 2) + 'px)' +
      (current.assembly && current.width && current.height ? ' scale(' + original.width / current.width + ',' + original.height / current.height + ')' : '');
    setTimeout(function () { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 230);
  }
  root.addEventListener('touchcancel', function () { releaseGrab(finger, true); finger = null; });
  root.addEventListener('touchend', function (event) {
    if (finger && finger.moved && event.cancelable) event.preventDefault();
    releaseGrab(finger, false);
    finger = null;
  }, touchOptions);

  window.addEventListener('resize', drawWires);
  if (teacher) listRooms();
  else join();
}());
