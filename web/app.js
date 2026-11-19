(function () {
  'use strict';

  var root = document.getElementById('app');
  var artURL = '/art.svg?v=7#';
  var stages = [
    ['拆解无人机', 'drone'], ['生活搜寻', 'computer'], ['小组研究', 'cooker'],
    ['彩灯编程', 'light'], ['电脑组装', 'board'], ['无人机改装', 'retrofit-drone']
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
  var flightStarted;
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
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var fullMotion = false;
  try { fullMotion = localStorage.getItem('modulelab-full-motion') === '1'; } catch (error) { }
  document.documentElement.classList.toggle('motion-full', fullMotion);

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
    if (method === 'POST') {
      request.setRequestHeader('Content-Type', 'application/json');
      if (!teacher && state && url.indexOf(studentURL() + '/') === 0) request.setRequestHeader('X-Classroom-Reset', String(state.reset));
    }
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
      'viewBox="0 0 320 200"' + (classes === 'assembly-art' ? ' preserveAspectRatio="none"' : '') +
      '><use xlink:href="' + artURL + esc(name) + '"></use></svg>';
  }

  function btn(text, action, classes, extra) {
    return '<button type="button" data-action="' + action + '" class="' + (classes || 'button') + '" ' + (extra || '') + '>' + text + '</button>';
  }

  function attr(name, value) { return 'data-' + name + '="' + esc(value) + '"'; }
  function pressed(value) { return ' aria-pressed="' + (value ? 'true' : 'false') + '"'; }
  function pad(number) { return number < 10 ? '0' + number : String(number); }
  function feedback() { return '<p id="message" class="note" role="status" aria-live="polite"></p>'; }

  function header(label, action) {
    return '<header class="top' + (!teacher && state ? ' student-top' : '') + '"><div class="top-inner"><a class="brand" href="' + (teacher ? '/teacher' : '/') + '">' + svg('brand') +
      '<span>模块化的应用</span></a><div class="top-right">' + (label ? '<span class="top-label">' + esc(label) + '</span>' : '') + (action || '') + '</div>' +
      (reducedMotion && (reducedMotion.matches || fullMotion) ? btn(fullMotion ? '跟随系统' : '播放完整动画', 'motion', 'button motion-button', 'id="motion"') : '') + '</div></header>';
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
    var reset = state.reset;
    api('GET', teacher ? roomURL() : studentURL() + '/status?since=' + state.version, null, function (status, data) {
      if (!state || state.code !== activeCode || (!teacher && state.reset !== reset)) return;
      if (status === 200) {
        if (teacher) updateRoom(data);
        else if (reset !== data.reset) { join(); return; }
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
    queuedFrame = {room: code, reset: state.reset, encoded: encoded};
    if (!liveTimer && !liveBusy) liveTimer = setTimeout(sendFrame, 160);
  }

  function sendFrame() {
    liveTimer = null;
    var next = queuedFrame;
    queuedFrame = null;
    if (!next || !state || next.room !== code || next.reset !== state.reset || next.encoded === lastFrame) return;
    liveBusy = true;
    api('POST', studentURL() + '/live', next.encoded, function (status) {
      liveBusy = false;
      if (state && code === next.room && state.reset === next.reset) {
        if (status === 204) lastFrame = next.encoded;
        if (!queuedFrame && (status === 0 || status === 429 || status >= 500)) queuedFrame = next;
      }
      if (queuedFrame && !liveTimer) liveTimer = setTimeout(sendFrame, status === 204 ? 160 : 650);
    });
  }

  function draft() { return drafts[stage]; }

  function newDraft(answer, index) {
    var values = answer ? answer.values : [];
    var saved = {values: values.slice(), text: answer ? answer.text || '' : '', selected: '', playing: false};
    if (index === 0) { saved.flight = values.indexOf('flight') >= 0; saved.values = values.filter(function (value) { return value !== 'flight'; }); saved.step = -1; }
    if (index === 1) saved.reveal = !!answer;
    if (index === 2) { saved.selected = values[0] || ''; saved.values = values.slice(1); }
    if (index === 5) saved.step = 0;
    if (index === 3) {
      saved.color = values[0] || 'blue';
      saved.values = values.slice(1, 4);
      saved.preview = -1;
      saved.mode = answer ? 'new' : 'old';
      saved.lights = makeLightWorkspace(values);
    }
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

  function benchArt(part, variant, spinning) {
    var size = fittings[part].size;
    return '<svg class="bench-art bench-' + variant + '" viewBox="0 0 ' + size.join(' ') + '" aria-hidden="true" focusable="false">' +
      (spinning ? '<g class="flight-blades">' : '') + '<use xlink:href="' + artURL + variant + '-' + part + '" width="' + size[0] + '" height="' + size[1] + '"></use>' +
      (spinning ? '</g>' : '') + '</svg>';
  }

  function stageOne() {
    var saved = draft();
    var active = find(content.items, saved.focus || saved.selected);
    return '<p class="instruction">把部件拖进形状相同的空槽，再试飞。</p>' + assemblyRack(content.items, saved.values) +
      '<div class="assembly-board drone-board' + (saved.playing ? ' flying' : '') + '"><div class="bench-layer bench-shadow">' + svg('drone-shadow', 'assembly-art') + '</div>' +
      '<div class="bench-device">' + svg('drone-frame', 'assembly-art') + (saved.playing ? '<div class="bench-layer flight-lights">' + svg('drone-flight-lights', 'assembly-art') + '</div>' : '') +
      content.items.map(function (item) { return sockets(item, item.id, has(item.id)); }).join('') + '</div></div>' +
      assemblyReadout(active, saved.playing ? '螺旋桨加速' : saved.flight ? '试飞完成' : '等待安装', saved.values.length, 6,
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
      var drawing = benchArt(part, mounted ? 'part' : 'shape', mounted && part === 'power' && saved.playing);
      if (mounted && part === 'screen' && saved.on) drawing += (saved.playing ? '<span class="bench-layer boot-splash">' + benchArt(part, 'display-start') + '</span>' : '') +
        '<span class="bench-layer boot-desktop">' + benchArt(part, 'display') + '</span>';
      if (mounted && part === 'power') drawing = '<span class="bench-layer rotor-spin">' + drawing + '</span>';
      if (mounted) drawing = '<span class="bench-layer mounted-part">' + drawing + '</span>';
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
      }).join('') + '</dl></section>' +
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

  var lightTimes = [500, 1000, 1500, 2000];
  var lightModes = {old: '不用模块', 'new': '使用模块'};

  function lightSettings(value, color) {
    var fields = value ? value.split(':') : [];
    return {color: fields[0] || color || 'blue', duration: Number(fields[1]) || 500, enabled: fields[2] !== 'off'};
  }

  function makeLightWorkspace(values) {
    return {direct: [lightSettings(values[4]), lightSettings(values[5]), lightSettings(values[6])],
      shared: values.length >= 4 ? lightSettings(values[7], values[0]) : null};
  }

  function lightValues(settings) {
    return settings.color + ':' + settings.duration + ':' + (settings.enabled ? 'on' : 'off');
  }

  function lightProgram(saved, mode, index) {
    return mode === 'old' ? saved.lights.direct[index] : (saved.values.indexOf('call-' + (index + 1)) >= 0 ? saved.lights.shared : null);
  }

  function lightField(key, field, label, options, current, disabled) {
    return '<select id="light-' + key + '-' + field + '" data-light-field="' + field + '" ' + attr('light-key', key) + ' aria-label="' + esc(label) + '"' + disabled + '>' + options.map(function (option) {
      return '<option value="' + esc(option[0]) + '"' + (option[0] === current ? ' selected' : '') + '>' + esc(option[1]) + '</option>';
    }).join('') + '</select>';
  }

  function lightStack(key, settings, heading, disabled, action) {
    return '<div class="light-stack" id="light-stack-' + key + '">' +
      (heading ? '<div class="light-block light-hat">' + heading + '</div>' : '') +
      '<div class="light-block light-output" data-light-command="output">' + lightField(key, 'state', '灯的状态', [['on', '点亮'], ['off', '保持熄灭']], settings.enabled ? 'on' : 'off', disabled) +
      lightField(key, 'color', '灯色', content.colors.map(function (color) { return [color.id, color.name]; }), settings.color, disabled) + '灯</div>' +
      '<div class="light-block light-clock" data-light-command="wait">等待' + lightField(key, 'time', '等待时长（秒）', lightTimes.map(function (duration) {
        return [duration, String(duration / 1000)];
      }), settings.duration, disabled) + '秒</div>' +
      '<div class="light-block light-output light-end" data-light-command="off">熄灭彩灯</div>' + (action || '') + '</div>';
  }

  function lightCrate() {
    return '<span class="light-crate" aria-hidden="true"><span class="light-crate-case"></span><span class="light-crate-lid"></span></span>';
  }

  function lightModule(saved, disabled) {
    var closed = !!saved.lightClosed;
    return '<div class="light-module">' + btn(lightCrate() + '<b>闪一次灯</b><span class="light-module-arrow" aria-hidden="true"></span>', 'light-open', 'light-module-toggle',
      'id="light-open" aria-controls="light-module-body" aria-expanded="' + !closed + '"' + disabled) +
      '<div class="light-module-body" id="light-module-body"' + (closed ? ' hidden' : '') + '>' + lightStack('shared', saved.lights.shared, '', disabled) + '</div></div>';
  }

  function packageLights(button, value) {
    var saved = draft();
    if (saved.lights.shared || saved.playing) return;
    var program = lightSettings(lightValues(saved.lights.direct[Number(value)]));
    saved.lights.shared = program;
    saved.color = program.color;
    saved.mode = 'new';
    saved.lightClosed = true;
    saved.lightStep = '';
    if (reducedMotion && reducedMotion.matches && !fullMotion) { renderStage('light-open'); return; }
    var stack = id('light-stack-' + value);
    var color = find(content.colors, program.color).name;
    Array.prototype.forEach.call(id('stage').querySelectorAll('button, select, textarea'), function (control) { control.disabled = true; });
    stack.innerHTML = '<div class="light-seal" role="status" aria-label="将三块积木封装为闪一次灯">' +
      '<div aria-hidden="true" class="light-seal-scene"><span class="light-seal-piece light-output">' + (program.enabled ? '点亮' + esc(color) + '灯' : '保持熄灭') + '</span>' +
      '<span class="light-seal-piece light-clock">等待 ' + program.duration / 1000 + ' 秒</span>' +
      '<span class="light-seal-piece light-output">熄灭彩灯</span><div class="light-seal-box">' + lightCrate() + '</div>' +
      '<b class="light-seal-name">闪一次灯</b></div></div>';
    stack.scrollIntoView({block: 'nearest'});
    queueFrame();
    clock = setTimeout(function () { renderStage('light-open'); }, 1500);
  }

  function lightComparison(saved) {
    return '<table class="light-comparison" aria-label="两种写法的灯光设置"><thead><tr><th scope="col">灯光设置</th>' + content.calls.map(function (phase) {
      return '<th scope="col">' + esc(phase) + '</th>';
    }).join('') + '</tr></thead><tbody>' + ['old', 'new'].map(function (mode) {
      return '<tr><th scope="row">' + lightModes[mode] + '</th>' + content.calls.map(function (phase, index) {
        var program = lightProgram(saved, mode, index);
        var color = program && find(content.colors, program.color);
        return '<td id="light-compare-' + mode + '-' + index + '">' + (program ? '<span class="light-chip light-' + (program.enabled ? esc(program.color) : 'off') + '">' +
          (program.enabled ? esc(color && color.name) : '不亮') + '</span><small>' + program.duration / 1000 + ' 秒</small>' : '<span class="light-missing">未接入</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  function stageFour() {
    var saved = draft();
    var mode = saved.mode || 'old';
    var lights = saved.lights;
    var disabled = saved.playing ? ' disabled' : '';
    var palette = btn('调用 闪一次灯', 'part', 'light-block light-call light-pick' + (saved.selected === 'module' ? ' picked' : ''),
      'id="pick-module" data-value="module"' + (saved.playing ? ' disabled' : ' data-piece="module"') + pressed(saved.selected === 'module'));
    var direct = '<div class="light-direct">' + lights.direct.map(function (settings, index) {
      return lightStack(index, settings, '当 ' + esc(content.calls[index]), disabled, !lights.shared ?
        btn('封装这组', 'light-package', 'button secondary light-package', 'id="light-package-' + index + '" ' + attr('value', index) + disabled) : '');
    }).join('') + '</div>';
    var calls = '<div class="light-call-list" aria-label="三段模块调用">' + content.calls.map(function (phase, index) {
      var slot = 'call-' + (index + 1);
      var filled = has(slot);
      return '<div class="light-call-row" id="light-line-' + index + '"><b>' + esc(phase) + '</b>' +
        (filled ? '<span class="light-block light-call">调用 闪一次灯</span>' : btn('接入调用', 'drop', 'light-block light-target', 'id="slot-' + slot + '" ' + attr('drop', slot) + ' aria-label="' + esc(phase + '：接入调用') + '"' + disabled)) +
        (filled ? btn('×', 'light-remove', 'light-remove', 'id="light-remove-' + slot + '" ' + attr('value', slot) + ' aria-label="' + esc('移除' + phase + '的调用') + '"' + disabled) : '') + '</div>';
    }).join('') + '</div>';
    var modular = lights.shared ? lightModule(saved, disabled) + '<div class="light-palette"><span>拖动或点选调用积木</span>' + palette + '</div>' + calls :
      '<p class="light-empty">先在「不用模块」中封装一组积木。</p>';
    return '<div class="light-mode-tabs" aria-label="选择编程方式">' + ['old', 'new'].map(function (name) {
      return btn(lightModes[name], 'light-mode', 'light-tab', 'id="light-mode-' + name + '" ' + attr('value', name) + pressed(name === mode) + disabled);
    }).join('') + '</div><div class="light-studio"><section class="light-editor" aria-label="积木工作区">' +
      (mode === 'old' ? direct : modular) + '</section><section class="light-preview" aria-label="无人机预览"><div class="light-preview-head"><h2>无人机预览</h2>' +
      btn(saved.playing ? '停止' : '运行', 'run', 'button primary', 'id="run-lights"' + (mode === 'new' && !lights.shared ? ' disabled' : '')) + '</div>' +
      '<div class="light-flight" id="light-flight"><div class="light-drone"><svg class="art" viewBox="0 0 320 200" aria-hidden="true" focusable="false">' +
      '<use xlink:href="' + artURL + 'drone"></use><path class="light-lenses" d="m54 129 10-2m193 0 10 2"/><g class="light-leds"><path class="light-glow" d="m54 129 10-2m193 0 10 2"/>' +
      '<path class="light-beam" d="m54 129 10-2m193 0 10 2"/><path class="light-core" d="m54 129 10-2m193 0 10 2"/></g></svg></div>' +
      '<p id="light-status" class="light-status" aria-live="polite">待运行</p></div>' + lightComparison(saved) + '</section></div>' +
      textField('只改一处，两种写法有什么不同？', saved.text, '对比三段灯光，写下你的发现。');
  }

  function syncLightPreview(saved, labels) {
    var flight = id('light-flight');
    if (!flight) return;
    var phase = saved.preview;
    var mode = saved.mode || 'old';
    var current = saved.playing && phase >= 0 && phase < labels.length;
    var command = current ? saved.lightStep || 'wait' : '';
    var program = current && lightProgram(saved, mode, phase);
    var lit = program && program.enabled && (command === 'output' || command === 'wait');
    var status = id('light-status');
    var label = current ? labels[phase] + ' · ' + (lit ? '灯亮' : command === 'skip' ? '未接入模块' : '灯灭') : saved.lightStep === 'done' ? '运行完成' : '待运行';
    if (status.textContent !== label) status.textContent = label;
    flight.className = 'light-flight' + (current && phase === 1 ? ' light-airborne' : '') + (lit ? ' light-lit light-' + program.color : '');
    labels.forEach(function (name, index) {
      var compare = id('light-compare-' + mode + '-' + index);
      var line = id('light-line-' + index);
      var active = current && phase === index;
      compare.classList.toggle('light-executing', active);
      if (line) line.classList.toggle('light-executing', active);
    });
    var activeStack = id('light-stack-' + (mode === 'new' ? 'shared' : phase));
    var commands = id('stage').querySelectorAll('[data-light-command]');
    Array.prototype.forEach.call(commands, function (node) {
      node.classList.toggle('light-executing', !!(program && activeStack && activeStack.contains(node) && node.getAttribute('data-light-command') === command));
    });
  }

  var computerParts = ['psu', 'ram', 'disk', 'screen', 'keyboard'];

  function stageFive() {
    var saved = draft();
    var active = find(content.parts, saved.focus || saved.selected);
    return '<p class="instruction">把部件拖进对应空槽，再按电源开机。</p>' + assemblyRack(content.parts, saved.slots) +
      '<div class="assembly-board pc-board' + (saved.on ? ' booted' : '') + (saved.playing ? ' starting' : '') + '"><div class="bench-device">' +
      svg('pc-workbench', 'assembly-art') + '<div class="bench-layer cpu-fan"><svg class="assembly-art" viewBox="57 64 32 32" aria-hidden="true" focusable="false">' +
      '<use xlink:href="' + artURL + 'pc-fan" width="320" height="200"></use></svg></div>' + (saved.on ? svg('pc-leds', 'assembly-art') : '') +
      computerParts.map(function (part, index) {
        return saved.slots[index] && part !== 'ram' ? svg('cable-' + part, 'assembly-art') : '';
      }).join('') + computerParts.map(function (part, index) {
        return sockets(find(content.parts, part), String(index), !!saved.slots[index]);
      }).join('') + '</div></div>' + assemblyReadout(active, saved.playing ? '风扇转动，正在开机' : saved.on ? '开机成功' : '等待安装', saved.slots.filter(Boolean).length, 5,
        btn(saved.playing ? '开机中…' : saved.on ? '已开机' : '按下电源', 'boot', 'button primary', 'id="boot"' + (saved.on ? ' disabled' : '')) +
        btn('拆下全部', 'reset', 'button secondary', 'id="reset"' + (saved.playing ? ' disabled' : '')));
  }

  var hillside = '<path d="M0 297l93-57 45 23 59-40 103 76 85-54 58 30 96-62 101 67v90H0z" fill="#344a51"/>' +
    '<path d="M0 329l97-37 88 19 86-30 104 29 139-46 126 43v63H0z" fill="#283d40"/><path d="M0 356l146-31 104 8 134-12 121 22 135-19v46H0z" fill="#44534b"/>' +
    '<path d="m76 345 32-6 13 5-12 6zm432 4 44-12 10 6-15 7zm-283 8 23-9 21 3-9 7z" fill="#687367"/>';

  var retrofitScenes = {
    wash: '<path d="M420 211l205-28v183H420z" fill="#789db3" stroke="#bed3dd" stroke-width="3"/><path d="m423 232 194-26v150H423z" fill="#355970"/>' +
      '<path d="m425 299 113-81 55-7-168 119z" fill="#7cabbc" opacity=".6"/><path d="m426 235 190-26v147H426z" fill="#a28f6d" opacity=".84" data-effect="dirt"/>' +
      '<path d="m425 261 190-24m-190 62 190-19m-190 53 190-9m-143-98v130m52-138v138m48-145v145" stroke="#cad8dc" stroke-width="3" opacity=".72"/>' +
      '<g data-effect="water" fill="none" stroke-linecap="round" opacity="0"><path data-effect="jet" stroke="#a2e8f7" stroke-width="5"/><path data-effect="jet-detail" stroke="#eeffff" stroke-width="2" stroke-dasharray="4 8"/></g>',
    grab: hillside + '<path data-effect="cable" stroke="#c5d9dc" stroke-width="2.5"/>' +
      '<g data-effect="litter"><path d="m-7 0 2-9 4-4 1-8 6 1 1 6 4 6-3 12z" fill="#85bfc3" stroke="#c6e4de" stroke-width="2"/><path d="M-4-7h13v5H-5z" fill="#e2d9ac"/></g>' +
      '<g data-effect="tongs" stroke="#182c38" stroke-width="2" stroke-linejoin="round"><path data-effect="jaw-left" d="M-3-3l-11 13 3 12 8 2 2-5-6-7 9-13z" fill="#a9c2d0"/>' +
      '<path data-effect="jaw-right" d="M3-3l11 13-3 12-8 2-2-5 6-7-9-13z" fill="#a9c2d0"/><rect x="-9" y="-9" width="18" height="12" rx="3" fill="#e7af64"/></g>',
    led: '<g fill="#d7e7f1" opacity=".65"><circle cx="77" cy="261" r="2"/><circle cx="183" cy="206" r="1.5"/><circle cx="536" cy="237" r="2"/><circle cx="590" cy="198" r="1.5"/><circle cx="469" cy="269" r="1.3"/></g>' +
      '<path d="M0 370v-55l32-6 24 16 34-1 24-30 22 16 23-4 20 30 32-19 73 9 56-17 35 16 58-8 26 18 36-27 53 18 38-17 54 19v42z" fill="#192e43"/>' +
      '<ellipse data-effect="washlight" cx="320" cy="309" rx="143" ry="26" fill="#7c8eff" opacity=".12"/>',
    cargo: hillside + '<path d="M42 346q90-36 170-14m-199 26q107-35 178-12m246-14q72-31 174 0m-194 16q93-25 200 0" fill="none" stroke="#799675" stroke-width="7"/>' +
      '<path d="m241 344 12-12h135l15 12v15H241z" fill="#334152" stroke="#7d919a" stroke-width="2"/><path data-effect="sling" fill="none" stroke="#f1c07e" stroke-width="2.5"/>' +
      '<g data-effect="crate"><path d="m-32-22 14-10h55l-15 10z" fill="#d4a773" stroke="#654a39" stroke-width="2"/><path d="m22-22 15-10v24L22 0z" fill="#906347" stroke="#654a39" stroke-width="2"/>' +
      '<path d="M-32-22h54V0h-54z" fill="#b38151" stroke="#654a39" stroke-width="2"/><path d="M-29-15h47m-47 7h47" stroke="#e6b784" stroke-width="2"/><path d="M-14-26q-21-13 1-13 11 3 14 12 17-19 27-10-1 10-25 12z" fill="#74a363"/><path d="m-18-32 19 8 19-10" fill="none" stroke="#c2d39a"/></g>',
    mist: '<path d="M0 309q160-43 321-13 149-33 319 12v62H0z" fill="#4e6350"/>' +
      '<path d="m-15 363 188-67m-112 74 152-75m-61 75 102-74m-10 74 43-76m47 76-9-73m113 73-67-74m165 74-124-74m253 74-209-75" stroke="#a4ad70" stroke-width="6" opacity=".6"/>' +
      '<ellipse data-effect="wet" cx="320" cy="326" rx="134" ry="23" fill="#a0dcc1" opacity="0"/><g data-effect="drops" stroke="#b4f5db" stroke-width="2.8" stroke-linecap="round"></g>',
    horn: '<path d="M0 339Q206 288 640 329v41H0z" fill="#344954"/><path d="M0 356q292-33 640 0" stroke="#729097" stroke-width="2" fill="none"/>' +
      '<g data-effect="waves" fill="none" stroke="#8ee4f4" stroke-width="3" stroke-linecap="round"><path d="M387 186q22 18 0 39"/><path d="M408 178q33 27 0 56"/><path d="M430 168q45 36 0 76"/></g>' +
      '<g data-effect="callout"><path d="M476 173h136v48H483l-19 10 8-15v-39z" fill="#e4fafb"/><text x="542" y="203" text-anchor="middle" fill="#19384f" font-size="23" font-weight="700">请慢行！</text></g>' +
      '<g transform="translate(538 303)" fill="#c5d2d2"><circle cy="-30" r="9"/><path d="M-11-18h22l4 22h-7L6 28H-1l-1-19-3 19h-7l1-24h-6z"/></g>',
    drop: '<path d="M0 348q309-64 640 0v22H0z" fill="#344956"/><ellipse cx="320" cy="337" rx="87" ry="22" fill="#22344a" stroke="#a9d6df" stroke-width="2" stroke-dasharray="8 5"/>' +
      '<ellipse data-effect="landing" cx="320" cy="337" rx="58" ry="13" fill="none" stroke="#9cebc2" stroke-width="3" opacity="0"/>' +
      '<g data-effect="parcel" stroke="#7b5b3c" stroke-width="2"><path d="m-19-16 10-6h27l-8 6v17h-29z" fill="#dfb680"/><path d="m10-16 8-6v16l-8 7z" fill="#aa7c4c"/>' +
      '<path d="M-6-16v16m0-16 8-6" stroke="#fff0ac" stroke-width="4"/></g>',
    thermal: hillside + '<path d="m326 223 105 93h158z" fill="#aa95ff" opacity=".12"/><rect x="422" y="230" width="190" height="118" rx="11" fill="#251f3a" stroke="#9c94c2" stroke-width="3"/>' +
      '<path d="m433 322 43-43 34 18 30-40 61 60v20H433z" fill="#4a3b71"/><path d="m434 329 45-12 47 8 48-26 27 17v21H434z" fill="#5a4282"/>' +
      '<g data-effect="heat" transform="translate(548 307)"><circle cy="-13" r="7" fill="#fff2b1"/><path d="M-7-4h14l5 16H6L4 23H-4l-1-11h-7z" fill="#ffab72"/><path d="M-18-22h7m22 0h7v7m0 32v8h-7m-22 0h-7v-8m0-32v-7" fill="none" stroke="#ffd780" stroke-width="2"/></g>' +
      '<path data-effect="scan" stroke="#cabaff" stroke-width="2.5" opacity="0"/>',
    beam: '<path d="M0 325l100-43 74 26 69-31 81 22 106-26 210 48v49H0z" fill="#283e4b"/>' +
      '<path d="M181 370l113-80h51l128 80z" fill="#44545c"/><path d="m287 370 36-76m-91 76 80-77m108 77-80-77" stroke="#88938c" stroke-width="2" opacity=".52"/>' +
      '<g data-effect="lightcone"><path d="M306 220h26l112 125q-111 38-247 0z" fill="#ffdb7a" opacity=".25"/><path d="M312 222h14l74 116q-79 20-168 0z" fill="#ffedaa" opacity=".27"/>' +
      '<ellipse cx="321" cy="342" rx="122" ry="20" fill="#ffdf85" opacity=".31"/><ellipse cx="321" cy="341" rx="79" ry="12" fill="#fff0b6" opacity=".47"/></g>'
  };

  function retrofitFixture(art, x, y, width, height) {
    return '<use xlink:href="' + artURL + esc(art) + '" x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '"></use>';
  }

  function stageSix() {
    var saved = draft();
    var active = find(content.modules, saved.values[saved.values.length - 1]);
    var scene = active ? retrofitScenes[active.id] : '';
    var payload = !active ? '' : retrofitFixture(active.id === 'grab' ? 'kit-grab-head' : active.id === 'drop' ? 'kit-drop-body' : active.art, 240, 154, 160, 100);
    if (active && active.id === 'drop') payload += '<g data-effect="hatch"><use xlink:href="' + artURL + 'kit-hatch" transform="translate(240 154) scale(.5)"></use></g>';
    if (active && active.id === 'led') payload += '<g data-effect="bulbs">' + [282.5, 301, 320, 339, 357.5].map(function (left) {
      return '<circle cx="' + left + '" cy="211" r="4.5" fill="#c2e9ff"/>';
    }).join('') + '</g>';
    return '<div class="retrofit-studio"><section class="retrofit-workbench" aria-label="无人机改装台">' +
      '<div class="retrofit-display"><svg class="retrofit-scene" viewBox="0 0 640 370" aria-hidden="true" focusable="false" ' + attr('kit', active ? active.id : '') + '>' +
      '<path d="M25 38V23h27m536 0h27v15m0 294v15h-27m-536 0H25v-15" fill="none" stroke="#8aacbd" stroke-width="2" opacity=".55"/>' +
      '<path d="M48 155h544m-544 56h544m-544 56h544m-544 56h544M160 37v281m160-281v281m160-281v281" stroke="#a2c7d6" stroke-width="1" stroke-dasharray="3 8" opacity=".25"/>' +
      scene + '<ellipse cx="320" cy="151" rx="217" ry="25" fill="#102131" opacity=".25"/>' +
      '<g data-effect="mount">' + payload + '</g>' + retrofitFixture('retrofit-drone', 80, 28, 480, 170) +
      (!active ? '<path d="M320 177v23m-13 0h26m-13-8v16" fill="none" stroke="#95d4e1" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="3 5"/><ellipse cx="320" cy="200" rx="29" ry="11" fill="none" stroke="#7ac6d7" stroke-width="2"/>' : '') + '</svg></div>' +
      '<div class="retrofit-bubble" aria-live="polite"><div><strong>' + (active ? esc(active.task) : '挂载口空着') + '</strong><p>' +
      (active ? esc(active.info) : '点一个模块，看看无人机能做什么。') + '</p></div>' + (active ? btn('再演示', 'retrofit-install', 'button secondary retrofit-replay', 'id="kit-replay" ' + attr('value', active.id)) : '') + '</div></section>' +
      '<section class="retrofit-tools"><div class="retrofit-head"><h2>加装模块</h2><span>已体验 <b>' + saved.values.length + '</b> / ' + content.modules.length + '</span></div>' +
      '<div class="retrofit-kit">' + content.modules.map(function (info) {
        var installed = active === info;
        var tried = has(info.id);
        return btn(svg(info.art) + '<strong>' + esc(info.name) + '</strong>' +
          (tried ? '<span class="retrofit-mark" aria-label="' + (installed ? '已加装' : '已体验') + '">✓</span>' : ''),
          'retrofit-install', 'retrofit-option' + (installed ? ' installed' : ''), 'id="kit-' + info.id + '" ' + attr('value', info.id) + pressed(installed));
      }).join('') + '</div></section></div>';
  }

  function interval(value, from, to) { return Math.max(0, Math.min(1, (value - from) / (to - from))); }

  function animateRetrofit(panel, playing, finished) {
    var scene = panel.querySelector('.retrofit-scene');
    var kit = scene.getAttribute('data-kit');
    if (!kit) return;
    var nodes = {};
    Array.prototype.forEach.call(scene.querySelectorAll('[data-effect]'), function (node) { nodes[node.getAttribute('data-effect')] = node; });
    var droplets = [];
    var gentle = reducedMotion && reducedMotion.matches && !fullMotion;
    var start = flightNow();
    var nextFrame = window.requestAnimationFrame ? function (callback) { window.requestAnimationFrame(callback); } : function (callback) { setTimeout(callback, 24); };
    var palette = ['#ff7494', '#ffcf78', '#71f4bb', '#8fe0ff', '#bfa7ff'];
    if (kit === 'mist') {
      for (var slot = 0; slot < 24; slot++) {
        var drop = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        nodes.drops.appendChild(drop);
        droplets.push(drop);
      }
    }

    function write(key, attribute, value) { nodes[key].setAttribute(attribute, value); }
    function move(key, left, top) { write(key, 'transform', 'translate(' + left + ' ' + top + ')'); }

    function draw() {
      if (!document.documentElement.contains(scene)) return;
      var age = flightNow() - start;
      var mount = playing ? interval(age, 0, gentle ? 170 : 350) : 1;
      var progress = playing ? interval(age, gentle ? 170 : 350, gentle ? 1300 : 3200) : 1;
      var pulse = Math.sin(progress * Math.PI);
      move('mount', 0, (1 - mount) * (gentle ? 7 : 22));
      write('mount', 'opacity', .55 + mount * .45);
      if (kit === 'wash') {
        var waterY = 242 + 101 * progress;
        var jet = 'M375 215Q459 218 600 ' + waterY;
        write('jet', 'd', jet);
        write('jet-detail', 'd', jet);
        write('jet-detail', 'stroke-dashoffset', -progress * 165);
        write('water', 'opacity', pulse * mount);
        write('dirt', 'opacity', .84 * (1 - progress));
      } else if (kit === 'grab') {
        var lift = interval(progress, .54, .91);
        var clawY = 222 + 93 * interval(progress, 0, .42) - 82 * lift;
        var closing = interval(progress, .42, .54);
        var jaw = -18 + 24 * closing;
        write('cable', 'd', 'M320 211V' + clawY);
        move('tongs', 320, clawY);
        write('jaw-left', 'transform', 'rotate(' + -jaw + ')');
        write('jaw-right', 'transform', 'rotate(' + jaw + ')');
        move('litter', 320, 341 - lift * 82);
      } else if (kit === 'led') {
        var color = Math.min(4, Math.floor(progress * 5));
        for (var bulb = 0; bulb < 5; bulb++) {
          nodes.bulbs.children[bulb].setAttribute('fill', palette[(bulb + color) % 5]);
          nodes.bulbs.children[bulb].setAttribute('opacity', bulb === color ? 1 : .75);
        }
        write('washlight', 'fill', palette[color]);
        write('washlight', 'opacity', .15 + pulse * .15);
      } else if (kit === 'cargo') {
        var crateY = 333 - 66 * interval(progress, .28, .89);
        move('crate', 320, crateY);
        write('sling', 'd', 'M292 ' + (crateY - 24) + 'L321 ' + Math.min(crateY - 31, 227) + 'L349 ' + (crateY - 25));
      } else if (kit === 'mist') {
        droplets.forEach(function (drop, index) {
          var flow = playing && progress < 1 ? (progress * 3 + index % 12 / 12) % 1 : .2 + index % 12 / 16;
          var spread = (index % 6 - 2.5) * 17 * flow;
          var left = (index < 12 ? 269 : 370) + spread;
          var top = 232 + 92 * flow;
          drop.setAttribute('x1', left);
          drop.setAttribute('y1', top);
          drop.setAttribute('x2', left + spread * .1);
          drop.setAttribute('y2', top + 4 + flow * 4);
          drop.setAttribute('opacity', mount * (.25 + .55 * pulse) * (1 - flow * .64));
        });
        write('wet', 'opacity', .35 * progress);
      } else if (kit === 'horn') {
        for (var wave = 0; wave < 3; wave++) {
          nodes.waves.children[wave].setAttribute('opacity', playing && progress < 1 ? .2 + .8 * Math.pow(Math.sin((progress * 2 - wave * .13) * Math.PI), 2) : .65);
        }
        write('callout', 'opacity', interval(progress, .15, .36));
      } else if (kit === 'drop') {
        var fall = interval(progress, .28, .81);
        write('hatch', 'transform', 'rotate(' + (73 * interval(progress, .06, .3)) + ' 303 221)');
        move('parcel', 322 - 2 * fall, 243 + 93 * fall * fall);
        write('parcel', 'opacity', interval(progress, .26, .34));
        write('landing', 'opacity', interval(progress, .78, .95));
      } else if (kit === 'thermal') {
        write('heat', 'opacity', interval(progress, .58, .79));
        write('scan', 'd', 'M' + (434 + 166 * progress) + ' 242v94');
        write('scan', 'opacity', pulse);
      } else if (kit === 'beam') {
        write('lightcone', 'opacity', interval(progress, .14, .5) * (.86 + .14 * pulse));
      }
      if (playing && progress < 1) nextFrame(draw);
      else if (finished) finished();
    }
    draw();
  }

  function renderStage(focus) {
    if (!content || !state || stage < 0) return;
    var activities = [stageOne, stageTwo, stageThree, stageFour, stageFive, stageSix];
    id('stage').innerHTML = title(stage) + activities[stage]() + '<div class="stage-footer">' + btn(state.done[stage] ? '更新记录' : '提交记录', 'submit-stage', 'button primary',
      'id="submit-stage"' + (submitting || (stage === 1 && !draft().reveal) || draft().playing ? ' disabled' : '')) + feedback() + '</div>';
    if (stage === 0 || stage === 4) fitBoard(id('stage'));
    if (stage === 0 && draft().playing) {
      var flying = draft();
      animateFlight(id('stage'), flightStarted, function () { flying.playing = false; flying.flight = true; renderStage('fly'); });
    }
    if (focus && id(focus) && !id(focus).disabled && document.activeElement !== id(focus)) id(focus).focus();
    if (stage === 2) drawWires();
    if (stage === 3) syncLightPreview(draft(), content.calls);
    if (stage === 5) {
      var saved = draft();
      animateRetrofit(id('stage'), saved.playing, saved.playing ? function () {
        saved.playing = false;
        if (id('submit-stage')) id('submit-stage').disabled = submitting;
        queueFrame();
      } : null);
    }
    queueFrame();
  }

  function submitStage() {
    if (submitting || !content) return;
    var saved = draft();
    var values = saved.values.slice();
    if (stage === 0 && saved.flight) values.push('flight');
    if (stage === 2) values.unshift(saved.selected);
    if (stage === 3) {
      if (saved.playing || !saved.lights.shared || values.length !== 3) { message('先接好三处模块调用，再提交。', 'error'); return; }
      values = [saved.color].concat(values.sort(), saved.lights.direct.concat(saved.lights.shared).map(lightValues));
    }
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
      if (id('submit-stage')) id('submit-stage').disabled = draft().playing || (stage === 1 && !draft().reveal);
      if (status === 200) updateStudent(data);
      if (!state || origin !== generation) return;
      if (status === 200) { renderStage('submit-stage'); message('记录已交给老师。', 'success'); }
      else { failed(data); if (status === 401 || status === 409 || status === 423 || status === 410) poll(); }
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
    flightStarted = flightNow();
    renderStage();
  }

  var flightPath = [
    [0, 0, 0, 0], [.13, 0, 0, 0], [.36, -1.5, -9, -2.5], [.59, 1.8, -11, 2.8],
    [.76, .4, -8.5, -1.3], [.96, 0, 0, 0], [1, 0, 0, 0]
  ];

  function flightNow() { return window.performance && window.performance.now ? window.performance.now() : Date.now(); }

  function animateFlight(panel, started, finished) {
    var board = panel.querySelector('.drone-board.flying');
    if (!board) return;
    var craft = board.querySelector('.bench-device');
    var shadow = board.querySelector('.bench-shadow');
    var lights = board.querySelector('.flight-lights');
    var rotors = board.querySelectorAll('.flight-blades');
    var readout = panel.querySelector('.effect-bubble strong');
    var gentle = reducedMotion && reducedMotion.matches && !fullMotion;
    var nextFrame = window.requestAnimationFrame ? function (callback) { window.requestAnimationFrame(callback); } : function (callback) { setTimeout(callback, 16); };
    if (typeof started !== 'number') started = flightNow();
    var segment = 1;
    var phase = '';

    function draw() {
      if (!document.documentElement.contains(board)) return;
      var progress = Math.max(0, Math.min((flightNow() - started) / 4600, 1));
      while (progress > flightPath[segment][0]) segment++;
      var before = flightPath[segment - 1];
      var after = flightPath[segment];
      var blend = (progress - before[0]) / (after[0] - before[0]);
      blend = blend * blend * (3 - 2 * blend);
      var lift = before[2] + (after[2] - before[2]) * blend;
      craft.style.top = (lift * (gentle ? .50 : 1)).toFixed(2) + '%';
      if (!gentle) {
        craft.style.left = (before[1] + (after[1] - before[1]) * blend).toFixed(2) + '%';
        craft.style.transform = 'rotate(' + (before[3] + (after[3] - before[3]) * blend).toFixed(2) + 'deg)';
        shadow.style.transform = 'scale(' + (1 - lift * .014).toFixed(3) + ',' + (1 + lift * .017).toFixed(3) + ')';
        lights.style.opacity = (0.68 + 0.32 * Math.cos(progress * 30)).toFixed(2);
      }
      shadow.style.opacity = (1 + lift * (gentle ? .02 : .045)).toFixed(2);
      var spin = progress < .16 ? progress * progress / .32 : progress < .82 ? progress - .08 : .83 - (1 - progress) * (1 - progress) / .36;
      var angle = spin / .83 * (gentle ? 2 : 26) * 360 % 360;
      for (var index = 0; index < rotors.length; index++) {
        rotors[index].setAttribute('transform', 'rotate(' + (index === 1 || index === 2 ? -angle : angle).toFixed(1) + ' 33 13)');
      }
      var label = progress < .13 ? '螺旋桨加速' : progress < .36 ? '正在起飞' : progress < .76 ? '空中悬停' : progress < .96 ? '正在降落' : '安全着陆';
      if (label !== phase) { readout.textContent = label; phase = label; }
      if (progress < 1) nextFrame(draw);
      else if (finished) finished();
    }

    nextFrame(draw);
  }

  function runLights() {
    var saved = draft();
    if (saved.playing) {
      clearTimeout(clock);
      saved.playing = false;
      saved.preview = -1;
      saved.lightStep = '';
      renderStage('run-lights');
      return;
    }
    var mode = saved.mode || 'old';
    saved.playing = true;
    saved.mode = mode;
    if (mode === 'new') saved.lightClosed = false;
    saved.selected = '';
    saved.preview = 0;
    saved.lightStep = '';
    renderStage('run-lights');
    function command(name, delay, next) {
      saved.lightStep = name;
      syncLightPreview(saved, content.calls);
      queueFrame();
      clock = setTimeout(next, delay);
    }
    function nextPhase() {
      saved.preview++;
      if (saved.preview < content.calls.length) { phase(); return; }
      saved.playing = false;
      saved.lightStep = 'done';
      renderStage();
    }
    function phase() {
      var program = lightProgram(saved, mode, saved.preview);
      if (!program) { command('skip', 550, nextPhase); return; }
      command('output', 260, function () {
        command('wait', program.duration - 260, function () { command('off', 500, nextPhase); });
      });
    }
    phase();
  }

  function compatible(value, target) {
    if (stage === 0 || stage === 2) return value === target && !has(value);
    if (stage === 3) return value === 'module' && draft().mode === 'new' && !!draft().lights.shared && !draft().playing && /^call-[123]$/.test(target) && !has(target);
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
      saved.lightStep = '';
    } else if (stage === 4) {
      saved.slots[Number(target)] = value;
      saved.selected = '';
      saved.on = false;
      saved.focus = value;
      saved.notice = 'mounted';
    } else return;
    renderStage(stage === 3 ? 'light-remove-' + target : 'slot-' + target);
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
      '<a class="button secondary teacher-only" href="' + roomURL() + '/export">导出 CSV</a>' +
      (state.active ? btn('清除学生数据', 'clear-students', 'button danger', 'id="clear-students"') : '') + '</div></div><ol class="chart">' + stages.map(function (info, index) {
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
    var clear = id('clear-students');
    if (clear) clear.disabled = !state.enrolled || clear.getAttribute('aria-busy') === 'true';
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
          (item.activity ? '<span class="pill">' + esc(item.activity) + '（旧活动）</span>' : '') + item.values.map(function (value) { return '<span class="pill">' + esc(value) + '</span>'; }).join('') + '</div>' + (item.text ? '<p>' + esc(item.text) + '</p>' : '') + '</article>';
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

  function clearStudents(button) {
    if (!state.active || roomSwitch || !state.enrolled) return;
    if (!window.confirm('清除「' + state.title + '」的全部学生座位、提交和投屏进度？此操作不可恢复，建议先导出 CSV。活动开放状态和历史课堂不受影响。仍开着学生页的浏览器会自动重新加入。')) return;
    var activeCode = state.code;
    var query = generation;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    api('POST', roomURL() + '/clear-students', {reset: state.reset}, function (status, data) {
      if (!state || state.code !== activeCode || query !== generation) return;
      button.removeAttribute('aria-busy');
      if (status === 401) { access(data.error); return; }
      if (status === 200) {
        updateRoom(data);
        if (!projection) { paintRoom(); message('本堂课的学生数据已清除。', 'success'); }
      } else {
        if (!projection) { paintRoom(); failed(data); }
        if (status === 409 || status === 410) poll();
      }
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
        '已放 ' + count + ' / 3', '已装 ' + count + ' / 5', '已体验 ' + count + ' 个模块'][entry.stage - 1];
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
    var isLights = frame.stage === 4;
    incoming.values = incoming.values || [];
    if (isLights && !incoming.lights) incoming.lights = makeLightWorkspace([incoming.color].concat(incoming.values));
    var layoutKey = JSON.stringify([frame.stage, frame.done, incoming], function (key, value) {
      return key === 'text' || (isLights && (key === 'preview' || key === 'lightStep')) ? undefined : value;
    });
    if (layoutKey === paintedFrame) {
      if (id('response') && id('response').value !== mirrorText) id('response').value = mirrorText;
      if (isLights) syncLightPreview(incoming, liveContent.calls);
      return;
    }
    paintedFrame = layoutKey;
    var previousStage = stage;
    var previousContent = content;
    var index = frame.stage - 1;
    var previousDraft = drafts[index];
    stage = index;
    content = liveContent;
    drafts[index] = incoming;
    var activities = [stageOne, stageTwo, stageThree, stageFour, stageFive, stageSix];
    var panel = id('stage');
    panel.removeAttribute('data-empty');
    panel.innerHTML = '<div class="stage-head"><span class="activity-number">' + pad(frame.stage) + '</span><h1>' + stages[index][0] + '</h1>' +
      (frame.done ? '<span class="pill green">已提交</span>' : '') + '</div>' + activities[index]();
    if (index === 0 || index === 4) fitBoard(panel);
    var controls = panel.querySelectorAll('button, textarea, select');
    Array.prototype.forEach.call(controls, function (control) { control.disabled = true; control.removeAttribute('draggable'); });
    if (index === 0 && incoming.playing) animateFlight(panel);
    if (index === 2) drawWires();
    if (isLights) syncLightPreview(incoming, content.calls);
    if (index === 5) animateRetrofit(panel, incoming.playing);
    if (previousDraft) drafts[index] = previousDraft;
    else delete drafts[index];
    stage = previousStage;
    content = previousContent;
  }

  var actions = {
    motion: function (button) {
      fullMotion = !fullMotion;
      document.documentElement.classList.toggle('motion-full', fullMotion);
      try { localStorage.setItem('modulelab-full-motion', fullMotion ? '1' : '0'); } catch (error) { }
      button.textContent = fullMotion ? '跟随系统' : '播放完整动画';
    },
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
    'pair-source': function (button, value) { draft().focus = draft().focus === value ? '' : value; draft().notice = ''; draft().wrong = false; renderStage(button.id); },
    'retrofit-install': function (button, value) {
      var saved = draft();
      var previous = saved.values.indexOf(value);
      if (previous >= 0) saved.values.splice(previous, 1);
      saved.values.push(value);
      saved.step++;
      saved.playing = true;
      renderStage(button.id);
    },
    run: runLights,
    'light-mode': function (button, value) {
      var saved = draft();
      saved.mode = value;
      saved.selected = '';
      saved.lightStep = '';
      renderStage(button.id);
    },
    'light-package': packageLights,
    'light-open': function (button) {
      var saved = draft();
      saved.lightClosed = !saved.lightClosed;
      button.setAttribute('aria-expanded', String(!saved.lightClosed));
      id('light-module-body').hidden = saved.lightClosed;
      queueFrame();
    },
    'light-remove': function (button, value) {
      toggle(value);
      draft().lightStep = '';
      renderStage('slot-' + value);
    },
    part: function (button, value) {
      var saved = draft();
      if (saved.playing) return;
      saved.focus = value;
      saved.notice = '';
      saved.wrong = false;
      saved.selected = button.classList.contains('installed') || saved.selected === value ? '' : value;
      renderStage(button.id);
    },
    drop: function (button) {
      if (draft().playing) return;
      var value = stage === 2 ? draft().focus : draft().selected;
      if (!value && button.hasAttribute('data-mounted')) { draft().focus = button.getAttribute('data-mounted'); draft().wrong = false; draft().notice = ''; renderStage(button.id); return; }
      if (!value) { message(stage === 3 ? '先选「调用 闪一次灯」，再点这里。' : stage === 2 ? '先点左边的模块名称。' : '先选一个部件，再点对应空槽。'); return; }
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
    'clear-students': clearStudents,
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
    var field = event.target.getAttribute('data-light-field');
    if (field && !teacher && stage === 3 && !draft().playing) {
      var saved = draft();
      var key = event.target.getAttribute('data-light-key');
      var program = key === 'shared' ? saved.lights.shared : saved.lights.direct[Number(key)];
      if (field === 'time') program.duration = Number(event.target.value);
      else if (field === 'state') program.enabled = event.target.value === 'on';
      else if (field === 'color') { program.color = event.target.value; if (key === 'shared') saved.color = program.color; }
      saved.lightStep = '';
      renderStage(event.target.id);
    }
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
    if (!cancelled && !destination) {
      suppressPiece = current.piece.id;
      suppressClick = Date.now() + 250;
    }
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
    if (teacher || finger || event.button !== 0 || !piece || (!piece.classList.contains('tray-piece') && !piece.classList.contains('light-pick'))) return;
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
