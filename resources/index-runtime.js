(function () {
  'use strict';
  // @ohmyppt-index-runtim:arcsin1:v2.0.16

  var pages = JSON.parse(document.getElementById('pages-data')?.textContent || '[]');
  var frameViewport = document.getElementById('frameViewport');
  var thumbs = document.getElementById('thumbs');
  var deckSwitcher = document.getElementById('deckSwitcher');
  var indicator = document.getElementById('indicator');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var tabsBtn = document.getElementById('tabsBtn');
  var presentBtn = document.getElementById('presentBtn');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var search = new URLSearchParams(window.location.search);
  var embedMode = search.get('embed') === '1';
  var presentMode = search.get('present') === '1';
  var playbackMode = !embedMode;
  var currentPageId = '';
  var fitRaf = 0;
  var indexTransitionType = 'fade';   // default, overridden by container build
  var indexTransitionDuration = 600;  // ms
  var playbackRequestSeq = 0;
  var pendingPlaybackRequests = {};
  var pageSwitchSeq = 0;
  var isPageSwitching = false;
  var prefetchedPageUrls = new Set();
  var wheelDeltaBuffer = 0;
  var wheelGestureLocked = false;
  var wheelGestureLockDirection = 0;
  var lastWheelNavigateAt = 0;
  var wheelGestureUnlockTimer = 0;
  var queuedNavigationOffset = 0;
  var WHEEL_NAV_THRESHOLD = 80;
  var WHEEL_NAV_COOLDOWN = 520;
  var WHEEL_GESTURE_IDLE = 260;
  var FRAME_LOAD_TIMEOUT = 3000;
  var INDEX_TRANSITION_TYPES = {
    none: true,
    fade: true,
    'slide-left': true,
    'slide-up': true,
    push: true,
    wipe: true,
    zoom: true,
    flip: true,
    stack: true,
    rotate: true,
    cube: true,
    'cover-flow': true,
    blur: true,
    iris: true,
    swing: true,
    'center-reveal': true
  };

  function normalizeIndexTransitionType(type) {
    var value = String(type || '').trim();
    return INDEX_TRANSITION_TYPES[value] ? value : 'fade';
  }

  function clampTransitionDuration(type, durationMs) {
    if (type === 'none') return 0;
    var duration = Number(durationMs);
    if (!Number.isFinite(duration)) duration = 600;
    return Math.max(120, Math.min(1200, Math.round(duration)));
  }

  function prefersReducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function ensureIndexTransitionBaseStyles() {
    if (document.getElementById('ppt-index-transition-base-styles')) return;
    var style = document.createElement('style');
    style.id = 'ppt-index-transition-base-styles';
    style.textContent =
      '.ppt-preview-viewport { perspective: 2400px; }' +
      '.ppt-preview-frame {' +
      '  --ppt-fit-transform: translate(0px, 0px) scale(1);' +
      '  --ppt-transition-x: 0px;' +
      '  --ppt-transition-y: 0px;' +
      '  --ppt-transition-scale: 1;' +
      '  --ppt-transition-rotate-y: 0deg;' +
      '  --ppt-transition-rotate-z: 0deg;' +
      '  transform: var(--ppt-fit-transform) translate3d(var(--ppt-transition-x), var(--ppt-transition-y), 0) scale(var(--ppt-transition-scale)) rotateY(var(--ppt-transition-rotate-y)) rotate(var(--ppt-transition-rotate-z));' +
      '  transform-style: preserve-3d;' +
      '  backface-visibility: hidden;' +
      '}' +
      '.ppt-preview-frame.ppt-transitioning {' +
      '  display: block !important;' +
      '  pointer-events: none !important;' +
      '  will-change: transform, opacity, clip-path, filter;' +
      '}';
    document.head.appendChild(style);
  }

  function ensurePresentBackgroundStyles() {
    if (document.getElementById('ppt-present-background-style')) return;
    var style = document.createElement('style');
    style.id = 'ppt-present-background-style';
    style.textContent =
      'body.present { background: #000000 !important; }' +
      'body.present .ppt-layout,' +
      'body.present .ppt-stage,' +
      'body.present .ppt-preview-viewport {' +
      '  background: #000000 !important;' +
      '}';
    document.head.appendChild(style);
  }

  function clearPendingPlaybackRequests() {
    Object.keys(pendingPlaybackRequests).forEach(function (requestId) {
      window.clearTimeout(pendingPlaybackRequests[requestId]);
      delete pendingPlaybackRequests[requestId];
    });
    if (wheelGestureUnlockTimer) {
      window.clearTimeout(wheelGestureUnlockTimer);
      wheelGestureUnlockTimer = 0;
    }
  }

  function resetWheelGestureState() {
    wheelDeltaBuffer = 0;
    wheelGestureLocked = false;
    wheelGestureLockDirection = 0;
    lastWheelNavigateAt = 0;
  }

  function getPageKey(page) {
    return String((page && (page.id || page.pageId)) || '');
  }

  function getLegacyPageId(page) {
    return String((page && page.pageId) || getPageKey(page));
  }

  var pageByKey = new Map();
  var pageIndexByKey = new Map();
  var legacyPageKeyById = new Map();
  pages.forEach(function (page, index) {
    var pageKey = getPageKey(page);
    if (!pageKey) return;
    pageByKey.set(pageKey, page);
    pageIndexByKey.set(pageKey, index);
    legacyPageKeyById.set(getLegacyPageId(page), pageKey);
  });

  // ── iframe pool: one per page, lazy-loaded on first visit ──
  var framePool = new Map();
  var loadedPages = new Set();
  var loadingFrames = new Map();
  var allFrames = frameViewport
    ? Array.from(frameViewport.querySelectorAll('.ppt-preview-frame'))
    : [];
  allFrames.forEach(function (el) {
    var pid = el.getAttribute('data-page-id');
    if (pid) framePool.set(pid, el);
  });

  // Build URL for a page iframe
  function buildPageUrl(page) {
    var url = new URL(page.htmlPath, window.location.href);
    url.searchParams.set('fit', 'off');
    if (embedMode) url.searchParams.set('embed', '1');
    if (playbackMode) url.searchParams.set('pptPlayback', '1');
    return url.toString();
  }

  function postPlaybackAdvanceToFrame(offset) {
    var frame = getActiveFrame();
    if (!frame) return false;
    try {
      var frameWindow = frame.contentWindow;
      if (!frameWindow || typeof frameWindow.postMessage !== 'function') return false;
      var requestId = 'playback-' + (++playbackRequestSeq);
      pendingPlaybackRequests[requestId] = window.setTimeout(function () {
        delete pendingPlaybackRequests[requestId];
        gotoOffset(offset || 1);
      }, 160);
      frameWindow.postMessage({
        type: 'ohmyppt:playback:advance',
        offset: offset || 1,
        requestId: requestId
      }, '*');
      return true;
    } catch (_) {}
    return false;
  }

  function requestNavigation(offset, options) {
    var navOffset = Number.isFinite(offset) && offset !== 0 ? offset : 1;
    var opts = options || {};
    if (isPageSwitching) {
      if (opts.queueWhileSwitching) queuedNavigationOffset = navOffset;
      return false;
    }
    if (navOffset > 0 && opts.allowPlaybackAdvance !== false) {
      if (playbackMode && postPlaybackAdvanceToFrame(1)) return true;
    }
    return gotoOffset(navOffset);
  }

  function resetWheelGestureSoon() {
    if (wheelGestureUnlockTimer) window.clearTimeout(wheelGestureUnlockTimer);
    wheelGestureUnlockTimer = window.setTimeout(function () {
      wheelGestureUnlockTimer = 0;
      wheelDeltaBuffer = 0;
      wheelGestureLocked = false;
      wheelGestureLockDirection = 0;
    }, WHEEL_GESTURE_IDLE);
  }

  function handlePresentationKey(event) {
    // Forward click advance to iframe first (for click-triggered animations)
    var clickForwardKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' '];
    if (clickForwardKeys.indexOf(event.key) >= 0) {
      if (isPageSwitching) {
        event.preventDefault();
        return;
      }
      if (playbackMode && postPlaybackAdvanceToFrame(1)) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      requestNavigation(1, { allowPlaybackAdvance: false });
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      if (isPageSwitching) return;
      requestNavigation(-1, { allowPlaybackAdvance: false });
      return;
    }
    if (event.key === 'Escape') {
      if (deckSwitcher) deckSwitcher.classList.remove('open');
    }
    if (event.key === 'Escape' && presentMode) {
      event.preventDefault();
      exitPresentMode();
    }
  }

  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    var tagName = String(target.tagName || '').toLowerCase();
    var closest = typeof target.closest === 'function'
      ? target.closest.bind(target)
      : function () { return null; };
    return Boolean(
      target.isContentEditable ||
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      closest('[contenteditable="true"]')
    );
  }

  function isDeckSwitcherWheelTarget(target) {
    if (!target || typeof target.nodeType !== 'number') return false;
    try {
      return Boolean(deckSwitcher && deckSwitcher.contains(target));
    } catch (_) {
      return false;
    }
  }

  function normalizeWheelDelta(event) {
    var delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= 900;
    return delta;
  }

  function handlePresentationWheel(event) {
    if (event.ctrlKey || event.metaKey) return;
    if (isEditableTarget(event.target)) return;
    if (isDeckSwitcherWheelTarget(event.target)) return;

    var delta = normalizeWheelDelta(event);
    if (!Number.isFinite(delta) || Math.abs(delta) < 1) return;
    var direction = delta > 0 ? 1 : -1;
    var isReverseGesture =
      wheelGestureLocked && wheelGestureLockDirection && direction !== wheelGestureLockDirection;

    if (Math.sign(delta) !== Math.sign(wheelDeltaBuffer)) wheelDeltaBuffer = 0;
    wheelDeltaBuffer += delta;
    resetWheelGestureSoon();

    if (Math.abs(wheelDeltaBuffer) < WHEEL_NAV_THRESHOLD) return;

    if (isReverseGesture) {
      wheelGestureLocked = false;
      wheelGestureLockDirection = 0;
      lastWheelNavigateAt = 0;
    }

    if (isPageSwitching) {
      wheelDeltaBuffer = 0;
      wheelGestureLocked = true;
      wheelGestureLockDirection = direction;
      if (isReverseGesture) queuedNavigationOffset = direction;
      event.preventDefault();
      return;
    }

    if (wheelGestureLocked) {
      wheelDeltaBuffer = 0;
      event.preventDefault();
      return;
    }

    var now = Date.now();
    if (now - lastWheelNavigateAt < WHEEL_NAV_COOLDOWN) {
      wheelDeltaBuffer = 0;
      wheelGestureLocked = true;
      wheelGestureLockDirection = direction;
      event.preventDefault();
      return;
    }

    var offset = wheelDeltaBuffer > 0 ? 1 : -1;
    wheelDeltaBuffer = 0;
    event.preventDefault();
    if (requestNavigation(offset)) {
      wheelGestureLocked = true;
      wheelGestureLockDirection = offset;
      lastWheelNavigateAt = now;
    } else {
      resetWheelGestureState();
    }
  }

  function bindFrameKeyboard(frame) {
    try {
      var frameWindow = frame.contentWindow;
      var frameDocument = frameWindow && frameWindow.document;
      if (!frameWindow || !frameDocument || frame.__ohmypptKeyboardDocument === frameDocument) return;
      frameWindow.addEventListener('keydown', handlePresentationKey);
      frame.__ohmypptKeyboardDocument = frameDocument;
    } catch (_) {}
  }

  function handleFramePlaybackMessage(event) {
    var frame = getActiveFrame();
    if (!frame) return;
    if (event.source && event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data) return;
    if (data.requestId && pendingPlaybackRequests[data.requestId]) {
      window.clearTimeout(pendingPlaybackRequests[data.requestId]);
      delete pendingPlaybackRequests[data.requestId];
    }
    if (data.type === 'ohmyppt:playback:handled') return;
    if (data.type !== 'ohmyppt:playback:goto') return;
    var offset = Number(data.offset);
    var navigated = requestNavigation(
      Number.isFinite(offset) && offset !== 0 ? offset : 1,
      { allowPlaybackAdvance: false, queueWhileSwitching: true }
    );
    if (data.requestId) {
      try {
        frame.contentWindow.postMessage({
          type: 'ohmyppt:playback:navigation-result',
          requestId: data.requestId,
          navigated: navigated
        }, '*');
      } catch (_) {}
    }
  }

  function prefetchPage(page) {
    if (!page || embedMode) return;
    try {
      var url = buildPageUrl(page);
      if (prefetchedPageUrls.has(url)) return;
      prefetchedPageUrls.add(url);
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = url;
      document.head.appendChild(link);
    } catch (_) {}
  }

  function prefetchAdjacentPages(pageId) {
    if (!Array.isArray(pages) || pages.length <= 1) return;
    var index = pageIndexByKey.has(pageId) ? pageIndexByKey.get(pageId) : -1;
    if (index < 0) return;
    [-1, 1].forEach(function (offset) {
      var page = pages[index + offset];
      if (page) prefetchPage(page);
    });
  }

  // Load or reload a page iframe so slide-level animations replay on revisit.
  function ensureFrameLoaded(pageId, forceReload, onReady) {
    var page = pageByKey.get(pageId);
    var frame = framePool.get(pageId);
    if (!page || !frame) return;
    if (loadedPages.has(pageId) && !forceReload) {
      bindFrameKeyboard(frame);
      if (typeof onReady === 'function') onReady(frame);
      return;
    }
    if (!forceReload && loadingFrames.has(pageId)) {
      var waitingCallbacks = loadingFrames.get(pageId);
      if (typeof onReady === 'function') waitingCallbacks.push(onReady);
      return;
    }
    var callbacks = typeof onReady === 'function' ? [onReady] : [];
    loadingFrames.set(pageId, callbacks);
    var pageUrl = new URL(buildPageUrl(page));
    if (forceReload) pageUrl.searchParams.set('_pptReplay', String(Date.now()));
    var loadToken = String(Date.now()) + '-' + Math.random();
    var loadTimer = 0;
    var ready = false;
    frame.__ohmypptLoadToken = loadToken;
    function finishLoad() {
      if (ready || frame.__ohmypptLoadToken !== loadToken) return;
      ready = true;
      if (loadTimer) window.clearTimeout(loadTimer);
      loadedPages.add(pageId);
      var readyCallbacks = loadingFrames.get(pageId) || [];
      loadingFrames.delete(pageId);
      bindFrameKeyboard(frame);
      if (pageId === currentPageId) scheduleFitFrame();
      readyCallbacks.forEach(function (callback) {
        if (typeof callback === 'function') callback(frame);
      });
    }
    frame.addEventListener('load', finishLoad, { once: true });
    loadTimer = window.setTimeout(finishLoad, FRAME_LOAD_TIMEOUT);
    frame.src = pageUrl.toString();
  }

  if (embedMode) document.body.classList.add('embed');

  function applyPresentMode(nextPresentMode, syncQuery) {
    presentMode = Boolean(nextPresentMode);
    document.body.classList.toggle('present', presentMode);
    if (presentBtn) {
      presentBtn.textContent = presentMode ? '退出演示' : '演示模式（ESC退出）';
    }
    if (fullscreenBtn) {
      fullscreenBtn.style.display = 'none';
    }
    if (syncQuery) {
      try {
        var next = new URLSearchParams(window.location.search);
        if (presentMode) next.set('present', '1');
        else next.delete('present');
        var query = next.toString();
        window.history.replaceState(
          null,
          '',
          window.location.pathname + (query ? '?' + query : '') + (window.location.hash || '')
        );
      } catch (_) {}
    }
    scheduleFitFrame();
  }

  function normalizePageId(hashValue) {
    var raw = (hashValue || '').replace(/^#/, '').trim();
    if (!raw && pages.length > 0) return getPageKey(pages[0]);
    var decoded = decodeURIComponent(raw || '');
    if (pageByKey.has(decoded)) return decoded;
    var legacyMatch = legacyPageKeyById.get(decoded);
    if (legacyMatch) return legacyMatch;
    return (pages[0] ? getPageKey(pages[0]) : '');
  }

  function getActiveFrame() {
    return currentPageId ? framePool.get(currentPageId) : null;
  }

  function applyFrameFit(frame) {
    if (!frame || !frameViewport) return;
    var rect = frameViewport.getBoundingClientRect();
    var rawScale = Math.min(rect.width / 1600, rect.height / 900);
    var scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
    var offsetX = Math.max(0, (rect.width - 1600 * scale) / 2);
    var offsetY = Math.max(0, (rect.height - 900 * scale) / 2);
    frame.style.setProperty(
      '--ppt-fit-transform',
      'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')'
    );
  }

  function fitFrame() {
    applyFrameFit(getActiveFrame());
  }

  function scheduleFitFrame() {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitFrame();
    });
  }

  function renderThumbs(activePageId) {
    if (!thumbs || embedMode) return;
    Array.from(thumbs.querySelectorAll('.ppt-thumb-item')).forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-page-id') === activePageId);
    });
  }

  function bindThumbEvents() {
    if (!thumbs) return;
    Array.from(thumbs.querySelectorAll('.ppt-thumb-item')).forEach(function (item) {
      item.addEventListener('click', function () {
        var pageId = item.getAttribute('data-page-id');
        if (!pageId) return;
        if (deckSwitcher) deckSwitcher.classList.remove('open');
        window.location.hash = '#' + encodeURIComponent(pageId);
      });
    });
  }

  function currentIndex() {
    return pageIndexByKey.has(currentPageId) ? pageIndexByKey.get(currentPageId) : -1;
  }

  function updateIndicator() {
    if (!indicator) return;
    var index = currentIndex();
    indicator.textContent = index >= 0 ? (index + 1) + ' / ' + pages.length : '--';
  }

  function resetTransitionFrame(frame) {
    if (!frame) return;
    frame.classList.remove('ppt-transitioning');
    frame.style.opacity = '';
    frame.style.zIndex = '';
    frame.style.clipPath = '';
    frame.style.filter = '';
    frame.style.transformOrigin = '';
    frame.style.setProperty('--ppt-transition-x', '0px');
    frame.style.setProperty('--ppt-transition-y', '0px');
    frame.style.setProperty('--ppt-transition-scale', '1');
    frame.style.setProperty('--ppt-transition-rotate-y', '0deg');
    frame.style.setProperty('--ppt-transition-rotate-z', '0deg');
  }

  function runAnime(targets, params) {
    var api = window.anime;
    try {
      if (api && typeof api.animate === 'function') return api.animate(targets, params);
      if (typeof api === 'function') return api(Object.assign({ targets: targets }, params));
    } catch (_) {}
    return null;
  }

  function waitForAnimeAnimations(animations, duration, callback) {
    var settled = false;
    var pending = 0;
    function done() {
      if (settled) return;
      settled = true;
      callback();
    }
    animations.forEach(function (animation) {
      var promise = animation && animation.finished && typeof animation.finished.then === 'function'
        ? animation.finished
        : (animation && typeof animation.then === 'function' ? animation : null);
      if (!promise) return;
      pending += 1;
      promise.then(function () {
        pending -= 1;
        if (pending <= 0) done();
      }, done);
    });
    if (pending <= 0) {
      window.setTimeout(done, Math.max(0, duration));
      return;
    }
    window.setTimeout(done, Math.max(80, duration + 120));
  }

  function transitionValue(percent) {
    return (Math.round(percent * 1000) / 1000) + '%';
  }

  function buildTransitionParams(type, direction, duration) {
    var d = direction < 0 ? -1 : 1;
    var ease = 'out(3)';
    var base = { duration: duration, ease: ease };
    if (type === 'slide-left') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-x': ['0%', transitionValue(-18 * d)],
          opacity: [1, 0.65]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-x': [transitionValue(100 * d), '0%'],
          opacity: [1, 1]
        })
      };
    }
    if (type === 'slide-up') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-y': ['0%', transitionValue(-18 * d)],
          opacity: [1, 0.65]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-y': [transitionValue(100 * d), '0%'],
          opacity: [1, 1]
        })
      };
    }
    if (type === 'push') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-x': ['0%', transitionValue(-100 * d)]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-x': [transitionValue(100 * d), '0%']
        })
      };
    }
    if (type === 'wipe') {
      return {
        oldParams: Object.assign({}, base, { opacity: [1, 0.88] }),
        newParams: Object.assign({}, base, {
          clipPath: d > 0
            ? ['inset(0 0 0 100%)', 'inset(0 0 0 0%)']
            : ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'],
          opacity: [1, 1]
        })
      };
    }
    if (type === 'zoom') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-scale': [1, 0.88],
          opacity: [1, 0]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-scale': [1.08, 1],
          opacity: [0, 1]
        })
      };
    }
    if (type === 'flip') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-rotate-y': ['0deg', (-72 * d) + 'deg'],
          opacity: [1, 0]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-rotate-y': [(72 * d) + 'deg', '0deg'],
          opacity: [0, 1]
        })
      };
    }
    if (type === 'stack') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-y': ['0px', (18 * d) + 'px'],
          '--ppt-transition-scale': [1, 0.96],
          opacity: [1, 0.55]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-y': [(-28 * d) + 'px', '0px'],
          '--ppt-transition-scale': [0.96, 1],
          opacity: [0, 1]
        })
      };
    }
    if (type === 'rotate') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-rotate-z': ['0deg', (-8 * d) + 'deg'],
          '--ppt-transition-scale': [1, 0.9],
          opacity: [1, 0]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-rotate-z': [(10 * d) + 'deg', '0deg'],
          '--ppt-transition-scale': [1.08, 1],
          opacity: [0, 1]
        })
      };
    }
    if (type === 'cube') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-x': ['0%', transitionValue(-34 * d)],
          '--ppt-transition-rotate-y': ['0deg', (-88 * d) + 'deg'],
          opacity: [1, 0.12]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-x': [transitionValue(34 * d), '0%'],
          '--ppt-transition-rotate-y': [(88 * d) + 'deg', '0deg'],
          opacity: [0.12, 1]
        })
      };
    }
    if (type === 'cover-flow') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-x': ['0%', transitionValue(-42 * d)],
          '--ppt-transition-scale': [1, 0.82],
          '--ppt-transition-rotate-y': ['0deg', (42 * d) + 'deg'],
          opacity: [1, 0.32]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-x': [transitionValue(42 * d), '0%'],
          '--ppt-transition-scale': [0.82, 1],
          '--ppt-transition-rotate-y': [(-42 * d) + 'deg', '0deg'],
          opacity: [0.32, 1]
        })
      };
    }
    if (type === 'blur') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-scale': [1, 1.035],
          filter: ['blur(0px)', 'blur(16px)'],
          opacity: [1, 0]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-scale': [0.965, 1],
          filter: ['blur(16px)', 'blur(0px)'],
          opacity: [0, 1]
        })
      };
    }
    if (type === 'iris') {
      return {
        oldParams: Object.assign({}, base, {
          opacity: [1, 0.75]
        }),
        newParams: Object.assign({}, base, {
          clipPath: ['circle(0% at 50% 50%)', 'circle(76% at 50% 50%)'],
          opacity: [1, 1]
        })
      };
    }
    if (type === 'swing') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-x': ['0%', transitionValue(-16 * d)],
          '--ppt-transition-rotate-z': ['0deg', (-12 * d) + 'deg'],
          '--ppt-transition-scale': [1, 0.94],
          opacity: [1, 0]
        }),
        newParams: Object.assign({}, base, {
          '--ppt-transition-x': [transitionValue(18 * d), '0%'],
          '--ppt-transition-rotate-z': [(12 * d) + 'deg', '0deg'],
          '--ppt-transition-scale': [0.96, 1],
          opacity: [0, 1]
        })
      };
    }
    if (type === 'center-reveal') {
      return {
        oldParams: Object.assign({}, base, {
          '--ppt-transition-scale': [1, 0.98],
          opacity: [1, 0.82]
        }),
        newParams: Object.assign({}, base, {
          clipPath: ['inset(0 50% 0 50%)', 'inset(0 0% 0 0%)'],
          '--ppt-transition-scale': [1.02, 1],
          opacity: [1, 1]
        })
      };
    }
    return {
      oldParams: Object.assign({}, base, { opacity: [1, 0] }),
      newParams: Object.assign({}, base, { opacity: [0, 1] })
    };
  }

  function applyPage(pageId, syncHash) {
    if (!Array.isArray(pages) || pages.length === 0) {
      document.body.classList.add('empty');
      if (indicator) indicator.textContent = '0 / 0';
      return;
    }
    document.body.classList.remove('empty');
    var page = pageByKey.get(pageId) || pages[0];
    if (!page) return;

    var previousPageId = currentPageId;
    var prevFrame = previousPageId ? framePool.get(previousPageId) : null;
    var nextPageId = getPageKey(page);
    var samePage = previousPageId === nextPageId;
    var switchSeq = ++pageSwitchSeq;
    if (previousPageId && !samePage) clearPendingPlaybackRequests();

    function finishSwitch() {
      if (switchSeq !== pageSwitchSeq) return;
      isPageSwitching = false;
      if (!queuedNavigationOffset) return;
      var nextOffset = queuedNavigationOffset;
      queuedNavigationOffset = 0;
      window.setTimeout(function () {
        requestNavigation(nextOffset, { allowPlaybackAdvance: false });
      }, 0);
    }

    function updatePageState() {
      if (switchSeq !== pageSwitchSeq) return;
      currentPageId = nextPageId;
      if (syncHash && window.location.hash !== '#' + encodeURIComponent(currentPageId)) {
        window.history.replaceState(null, '', '#' + encodeURIComponent(currentPageId));
      }
      renderThumbs(currentPageId);
      updateIndicator();
      prefetchAdjacentPages(currentPageId);
    }

    function switchFrame() {
      if (switchSeq !== pageSwitchSeq) return;
      if (prevFrame) {
        prevFrame.classList.remove('active');
        resetTransitionFrame(prevFrame);
      }
      var nextFrame = framePool.get(nextPageId);
      if (nextFrame) {
        nextFrame.classList.add('active');
        resetTransitionFrame(nextFrame);
      }
      updatePageState();
      scheduleFitFrame();
    }

    function animateFrameSwitch(done) {
      if (switchSeq !== pageSwitchSeq) return;
      var nextFrame = framePool.get(nextPageId);
      var canAnimate =
        indexTransitionType !== 'none' &&
        !prefersReducedMotion() &&
        previousPageId &&
        !samePage &&
        prevFrame &&
        nextFrame;
      if (!canAnimate) {
        switchFrame();
        done();
        return;
      }
      var previousIndex = pageIndexByKey.has(previousPageId) ? pageIndexByKey.get(previousPageId) : -1;
      var nextIndex = pageIndexByKey.has(nextPageId) ? pageIndexByKey.get(nextPageId) : previousIndex + 1;
      var direction = previousIndex >= 0 && nextIndex < previousIndex ? -1 : 1;
      var duration = clampTransitionDuration(indexTransitionType, indexTransitionDuration);

      resetTransitionFrame(prevFrame);
      resetTransitionFrame(nextFrame);
      applyFrameFit(prevFrame);
      applyFrameFit(nextFrame);
      prevFrame.classList.add('active', 'ppt-transitioning');
      nextFrame.classList.add('active', 'ppt-transitioning');
      prevFrame.style.zIndex = '1';
      nextFrame.style.zIndex = '2';
      updatePageState();

      var params = buildTransitionParams(indexTransitionType, direction, duration);
      var oldAnimation = runAnime(prevFrame, params.oldParams);
      var newAnimation = runAnime(nextFrame, params.newParams);
      var animations = [oldAnimation, newAnimation];
      if (!animations.some(Boolean)) {
        if (switchSeq !== pageSwitchSeq) return;
        prevFrame.classList.remove('active');
        resetTransitionFrame(prevFrame);
        resetTransitionFrame(nextFrame);
        scheduleFitFrame();
        done();
        return;
      }
      waitForAnimeAnimations(animations, duration, function () {
        if (switchSeq !== pageSwitchSeq) return;
        prevFrame.classList.remove('active');
        resetTransitionFrame(prevFrame);
        resetTransitionFrame(nextFrame);
        scheduleFitFrame();
        done();
      });
    }

    function commitWhenReady() {
      if (switchSeq !== pageSwitchSeq) return;
      animateFrameSwitch(finishSwitch);
    }

    isPageSwitching = !samePage;
    ensureFrameLoaded(nextPageId, loadedPages.has(nextPageId) && !samePage, commitWhenReady);
    if (samePage) finishSwitch();
  }

  function gotoOffset(offset) {
    if (!Array.isArray(pages) || pages.length === 0) return false;
    if (isPageSwitching) return false;
    var index = currentIndex();
    if (index < 0) return false;
    var target = Math.max(0, Math.min(pages.length - 1, index + offset));
    if (target === index) return false;
    var targetPage = pages[target];
    if (!targetPage) return false;
    window.location.hash = '#' + encodeURIComponent(getPageKey(targetPage));
    return true;
  }

  function onHashChange() {
    var pageId = normalizePageId(window.location.hash);
    applyPage(pageId, false);
  }

  function togglePresentMode() {
    applyPresentMode(!presentMode, true);
    if (presentMode && !document.fullscreenElement) {
      try { document.documentElement.requestFullscreen(); } catch (_) {}
    } else if (!presentMode && document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (_) {}
    }
  }

  function exitPresentMode() {
    if (!presentMode) return;
    applyPresentMode(false, true);
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (_) {}
    }
  }

  function toggleFullscreen() {
    togglePresentMode();
  }

  // Read transition config from container data attribute
  try {
    var transitionConfig = document.getElementById('ppt-index-transition-config');
    if (transitionConfig) {
      var config = JSON.parse(transitionConfig.textContent || '{}');
      indexTransitionType = normalizeIndexTransitionType(config.type);
      indexTransitionDuration = clampTransitionDuration(indexTransitionType, config.durationMs);
    }
  } catch (_) {}

  ensureIndexTransitionBaseStyles();
  ensurePresentBackgroundStyles();

  bindThumbEvents();
  if (prevBtn) prevBtn.addEventListener('click', function () { gotoOffset(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { gotoOffset(1); });
  if (tabsBtn) tabsBtn.addEventListener('click', function () { if (deckSwitcher) deckSwitcher.classList.toggle('open'); });
  if (presentBtn) presentBtn.addEventListener('click', function () { togglePresentMode(); });
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', function () { toggleFullscreen(); });
  window.addEventListener('resize', function () { scheduleFitFrame(); });
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('keydown', handlePresentationKey);
  window.addEventListener('wheel', handlePresentationWheel, { passive: false });
  window.addEventListener('message', handleFramePlaybackMessage);
  window.addEventListener('pagehide', clearPendingPlaybackRequests);
  window.addEventListener('beforeunload', clearPendingPlaybackRequests);
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && presentMode) {
      exitPresentMode();
    }
  });
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Node)) return;
    if (!deckSwitcher || !deckSwitcher.classList.contains('open')) return;
    var inSwitcher = deckSwitcher.contains(target);
    var inTabsButton = tabsBtn && tabsBtn.contains(target);
    if (!inSwitcher && !inTabsButton) {
      deckSwitcher.classList.remove('open');
    }
  });

  applyPresentMode(presentMode, false);
  applyPage(normalizePageId(window.location.hash), true);
  scheduleFitFrame();
})();
