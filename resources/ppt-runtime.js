(function initPptRuntime(global) {
  if (!global || typeof global !== "object") return;
  // @ohmyppt-ppt-runtime:arcsin1:v2.0.17

  var ppt = global.PPT && typeof global.PPT === "object" ? global.PPT : (global.PPT = {});
  if (ppt.__runtimeVersion === "2.0.17") return;
  ppt.__runtimeVersion = "2.0.17";

  function resolveSearchParams() {
    try {
      return new URLSearchParams(global.location ? global.location.search : "");
    } catch (_err) {
      return new URLSearchParams();
    }
  }

  var search = resolveSearchParams();
  var isPrintMode = search.get("print") === "1";
  var printTimeoutMs = Math.max(1000, Number(search.get("printTimeoutMs")) || 40000);
  var printReadyEmitted = false;
  var pendingPrintTasks = [];

  function trackPrintTask(promise) {
    if (!promise || typeof promise.then !== "function") return promise;
    var wrapped = Promise.resolve(promise).catch(function () { return null; });
    pendingPrintTasks.push(wrapped);
    wrapped.finally(function () {
      var idx = pendingPrintTasks.indexOf(wrapped);
      if (idx >= 0) pendingPrintTasks.splice(idx, 1);
    });
    return wrapped;
  }

  function waitFrames(frames) {
    var count = Math.max(1, Number(frames) || 1);
    return new Promise(function (resolve) {
      function next(remaining) {
        if (remaining <= 0) {
          resolve();
          return;
        }
        if (typeof global.requestAnimationFrame === "function") {
          global.requestAnimationFrame(function () {
            next(remaining - 1);
          });
          return;
        }
        setTimeout(function () {
          next(remaining - 1);
        }, 16);
      }
      next(count);
    });
  }

  function resolvePageIdForPrint() {
    var explicit = search.get("pageId");
    if (explicit && explicit.trim()) return explicit.trim();
    try {
      var bodyId = global.document && document.body ? document.body.getAttribute("data-page-id") : "";
      if (bodyId && bodyId.trim()) return bodyId.trim();
      var pathname = global.location ? String(global.location.pathname || "") : "";
      var match = pathname.match(/(page-\d+)\.html?$/i);
      if (match && match[1]) return match[1];
    } catch (_err) {}
    return "page-unknown";
  }

  function emitPrintReadyOnce() {
    if (!isPrintMode || printReadyEmitted) return;
    printReadyEmitted = true;
    var pageId = resolvePageIdForPrint();
    try {
      console.log("__PPT_PRINT_READY__dfaarcsin1_:" + pageId);
    } catch (_err) {}
  }

  function parseStyleNumber(value, withPx) {
    if (typeof value === "number") {
      return withPx ? String(value) + "px" : String(value);
    }
    return String(value);
  }

  function toKebabCase(input) {
    return String(input).replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); });
  }

  function resolveFinalValue(rawValue, el, index, total) {
    var value = rawValue;
    if (typeof value === "function") {
      try {
        value = value(el, index, total);
      } catch (_err) {
        value = null;
      }
    }
    if (Array.isArray(value) && value.length > 0) {
      value = value[value.length - 1];
    }
    if (value && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "to")) value = value.to;
      else if (Object.prototype.hasOwnProperty.call(value, "value")) value = value.value;
      else if (Object.prototype.hasOwnProperty.call(value, "end")) value = value.end;
    }
    return value;
  }

  function normalizeTargets(rawTargets) {
    if (!rawTargets) return [];
    if (typeof rawTargets === "string") {
      return global.document ? Array.prototype.slice.call(document.querySelectorAll(rawTargets)) : [];
    }
    if (rawTargets instanceof Element) return [rawTargets];
    if (rawTargets && typeof rawTargets.length === "number") {
      return Array.prototype.slice.call(rawTargets).filter(function (item) {
        return item instanceof Element;
      });
    }
    return [];
  }

  function applyPrintAnimationEndState(rawTargets, params) {
    var targets = normalizeTargets(rawTargets);
    if (!targets.length || !params || typeof params !== "object") return;
    // Mark animated targets so the PPTX export can keep them in the background screenshot
    targets.forEach(function (el) {
      if (el && el.nodeType === 1) el.setAttribute("data-pptx-animated", "1");
    });
    var transformKeys = {
      x: true,
      y: true,
      translateX: true,
      translateY: true,
      translateZ: true,
      scale: true,
      scaleX: true,
      scaleY: true,
      rotate: true,
      rotateX: true,
      rotateY: true,
      rotateZ: true,
      skewX: true,
      skewY: true,
    };
    var skipKeys = {
      targets: true,
      delay: true,
      duration: true,
      easing: true,
      autoplay: true,
      loop: true,
      complete: true,
      begin: true,
      update: true,
      keyframes: true,
      direction: true,
      alternate: true,
      reversed: true,
    };

    targets.forEach(function (el, index) {
      var transformParts = [];
      Object.keys(params).forEach(function (key) {
        if (skipKeys[key]) return;
        var finalValue = resolveFinalValue(params[key], el, index, targets.length);
        if (finalValue === undefined || finalValue === null) return;

        if (key === "opacity") {
          el.style.opacity = String(finalValue);
          return;
        }
        if (key === "x") {
          transformParts.push("translateX(" + parseStyleNumber(finalValue, true) + ")");
          return;
        }
        if (key === "y") {
          transformParts.push("translateY(" + parseStyleNumber(finalValue, true) + ")");
          return;
        }
        if (transformKeys[key]) {
          if (key.indexOf("scale") === 0) {
            transformParts.push(key + "(" + String(finalValue) + ")");
          } else if (key.indexOf("rotate") === 0 || key.indexOf("skew") === 0) {
            var rotateValue = typeof finalValue === "number" ? String(finalValue) + "deg" : String(finalValue);
            transformParts.push(key + "(" + rotateValue + ")");
          } else {
            transformParts.push(key + "(" + parseStyleNumber(finalValue, true) + ")");
          }
          return;
        }

        var unitless = key === "zIndex" || key === "fontWeight" || key === "lineHeight" || key === "order";
        if (key in el.style) {
          el.style[key] = unitless ? String(finalValue) : parseStyleNumber(finalValue, typeof finalValue === "number");
          return;
        }
        el.style.setProperty(toKebabCase(key), unitless ? String(finalValue) : parseStyleNumber(finalValue, typeof finalValue === "number"));
      });

      if (transformParts.length > 0) {
        el.style.transform = transformParts.join(" ");
      }
    });
  }

  function buildStagger(step, options) {
    var start = Number((options && options.start) || 0);
    var gap = Number(step || 0);
    return function (_el, i) {
      return start + i * gap;
    };
  }

  function buildTimeline(animeApi) {
    return function (_options) {
      return {
        add: function (params) {
          if (!params || typeof params !== "object") return this;
          var run = animeApi && typeof animeApi.animate === "function"
            ? animeApi.animate.bind(animeApi)
            : (typeof animeApi === "function" ? animeApi : null);
          if (run) run(params);
          return this;
        },
      };
    };
  }

  function resolveAnime() {
    return global.anime;
  }

  function getChartRegistry() {
    if (!(global.__PPT_CHART_REGISTRY__ instanceof Map)) {
      global.__PPT_CHART_REGISTRY__ = new Map();
    }
    return global.__PPT_CHART_REGISTRY__;
  }

  function resolveChartTarget(target) {
    var resolved = target;
    if (typeof target === "string") {
      resolved = global.document ? (document.querySelector(target) || document.getElementById(target)) : null;
    }
    if (resolved && resolved.canvas) {
      resolved = resolved.canvas;
    }
    if (resolved && typeof resolved.getContext === "function") {
      return { canvas: resolved, chartTarget: resolved };
    }
    if (resolved && typeof resolved.querySelector === "function") {
      var nestedCanvas = resolved.querySelector("canvas");
      if (nestedCanvas && typeof nestedCanvas.getContext === "function") {
        return { canvas: nestedCanvas, chartTarget: nestedCanvas };
      }
    }
    return { canvas: resolved || null, chartTarget: resolved || null };
  }

  function withPrintChartConfig(config) {
    if (!config || typeof config !== "object") return config;
    var safe = Object.assign({}, config);
    normalizeChartConfig(safe);
    if (!isPrintMode) return safe;
    var options = Object.assign({}, (safe.options && typeof safe.options === "object") ? safe.options : {});
    options.animation = false;
    options.responsive = false;
    options.maintainAspectRatio = false;
    safe.options = options;
    ensureChartNumberFormatters(safe);
    return safe;
  }

  function trimFloatingNoise(value, maxDecimals) {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    var decimals = Math.max(0, Math.min(12, Number(maxDecimals) || 6));
    var factor = Math.pow(10, decimals);
    var rounded = Math.round((value + Number.EPSILON) * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function formatChartNumber(value, maxDecimals) {
    if (typeof value !== "number" || !Number.isFinite(value)) return String(value == null ? "" : value);
    return String(trimFloatingNoise(value, maxDecimals));
  }

  function normalizeChartScalar(value) {
    if (typeof value === "number") return trimFloatingNoise(value, 6);
    if (typeof value === "string" && /^-?\d+\.\d{7,}$/.test(value.trim())) {
      var parsed = Number(value);
      if (Number.isFinite(parsed)) return formatChartNumber(parsed, 6);
    }
    return value;
  }

  function normalizeChartData(value) {
    if (Array.isArray(value)) return value.map(normalizeChartData);
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        value[key] = normalizeChartData(value[key]);
      });
      return value;
    }
    return normalizeChartScalar(value);
  }

  function isLikelyCategoryScale(config, scaleKey, scale) {
    if (scale && scale.type === "category") return true;
    if (scale && scale.type) return false;
    var data = config && config.data && typeof config.data === "object" ? config.data : null;
    if (!data || !Array.isArray(data.labels)) return false;
    var options = config && config.options && typeof config.options === "object" ? config.options : null;
    var defaultCategoryAxis = options && options.indexAxis === "y" ? "y" : "x";
    return scaleKey === defaultCategoryAxis;
  }

  function resolveChartTooltipValue(context) {
    if (!context) return "";
    var chartOptions = context.chart && context.chart.options && typeof context.chart.options === "object"
      ? context.chart.options
      : null;
    var indexAxis = chartOptions && chartOptions.indexAxis === "y" ? "y" : "x";
    var parsed = context.parsed && typeof context.parsed === "object" ? context.parsed : null;
    if (parsed) {
      var valueAxis = indexAxis === "y" ? "x" : "y";
      if (parsed[valueAxis] !== undefined) return parsed[valueAxis];
      if (parsed.y !== undefined) return parsed.y;
      if (parsed.x !== undefined) return parsed.x;
    }
    if (context.formattedValue !== undefined) return context.formattedValue;
    return context.raw;
  }

  function ensureChartNumberFormatters(config) {
    if (!config || typeof config !== "object") return;
    var options = config.options && typeof config.options === "object" ? config.options : (config.options = {});
    var scales = options.scales && typeof options.scales === "object" ? options.scales : null;
    if (scales) {
      Object.keys(scales).forEach(function (scaleKey) {
        var scale = scales[scaleKey];
        if (!scale || typeof scale !== "object") return;
        var ticks = scale.ticks && typeof scale.ticks === "object" ? scale.ticks : (scale.ticks = {});
        if (typeof ticks.callback !== "function") {
          if (isLikelyCategoryScale(config, scaleKey, scale)) {
            ticks.callback = function (value) {
              if (this && typeof this.getLabelForValue === "function") {
                return this.getLabelForValue(value);
              }
              return String(value == null ? "" : value);
            };
          } else {
            ticks.callback = function (value) {
              return typeof value === "number" ? formatChartNumber(value, 6) : String(value);
            };
          }
        }
      });
    }
    var plugins = options.plugins && typeof options.plugins === "object" ? options.plugins : (options.plugins = {});
    var tooltip = plugins.tooltip && typeof plugins.tooltip === "object" ? plugins.tooltip : (plugins.tooltip = {});
    var callbacks = tooltip.callbacks && typeof tooltip.callbacks === "object" ? tooltip.callbacks : (tooltip.callbacks = {});
    if (typeof callbacks.label !== "function") {
      callbacks.label = function (context) {
        var label = context && context.dataset && context.dataset.label ? String(context.dataset.label) + ": " : "";
        var value = resolveChartTooltipValue(context);
        return label + (typeof value === "number" ? formatChartNumber(value, 6) : String(value == null ? "" : value));
      };
    }
  }

  function normalizeChartConfig(config) {
    if (config && config.data) {
      config.data = normalizeChartData(config.data);
    }
    ensureChartNumberFormatters(config);
    return config;
  }

  function resolveChartInstance(ChartCtor, target, canvas) {
    var chart = null;
    if (ChartCtor && typeof ChartCtor.getChart === "function") {
      try { chart = ChartCtor.getChart(target) || null; } catch (_err) {}
      if (!chart && canvas) {
        try { chart = ChartCtor.getChart(canvas) || null; } catch (_err) {}
      }
    }
    if (!chart && canvas) {
      chart = getChartRegistry().get(canvas) || null;
    }
    return chart;
  }

  function collectChartInstances(ChartCtor) {
    var set = new Set();
    var registry = getChartRegistry();
    registry.forEach(function (chart) {
      if (chart) set.add(chart);
    });
    if (ChartCtor && ChartCtor.instances) {
      var values = Array.isArray(ChartCtor.instances)
        ? ChartCtor.instances
        : Object.values(ChartCtor.instances);
      values.forEach(function (chart) {
        if (chart) set.add(chart);
      });
    }
    return Array.from(set);
  }

  function renderMath(root) {
    var target = root || (global.document ? document.body : null);
    if (!target || typeof global.renderMathInElement !== "function") {
      return Promise.resolve(false);
    }
    try {
      global.renderMathInElement(target, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
        ],
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
        ignoredClasses: ["katex", "katex-display", "katex-html", "katex-mathml"],
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
    } catch (err) {
      try { console.warn("[PPT.renderMath] arcsin1 failed", err); } catch (_err) {}
      return Promise.resolve(false);
    }
    return waitFrames(2).then(function () { return true; });
  }

  function markChartReady(chart) {
    if (!chart || typeof chart !== "object") return Promise.resolve();
    var readyTask = waitFrames(2).then(function () {
      if (typeof chart.resize === "function") {
        try { chart.resize(); } catch (_err) {}
      }
      if (typeof chart.update === "function") {
        try { chart.update("none"); } catch (_err) {}
      }
    });
    return trackPrintTask(readyTask);
  }

  function createCompletedAnimationStub() {
    var done = Promise.resolve();
    return {
      finished: done,
      play: function () {},
      pause: function () {},
      restart: function () {},
      seek: function () {},
      remove: function () {},
      cancel: function () {},
    };
  }

  var _activeAnimations = new Set();

  function resolveGsap() {
    return global.gsap;
  }

  function translateAnimKey(animeKey, value) {
    var gsapKey = null;
    var gsapValue = value;
    switch (animeKey) {
      case "translateX":
        gsapKey = "x";
        break;
      case "translateY":
        gsapKey = "y";
        break;
      case "translateZ":
        gsapKey = "z";
        break;
      case "scaleX":
      case "scaleY":
      case "scale":
        gsapKey = animeKey;
        break;
      case "rotate":
      case "rotateX":
      case "rotateY":
      case "rotateZ":
        gsapKey = animeKey === "rotate" ? "rotation" : animeKey;
        if (typeof gsapValue === "number") gsapValue = gsapValue;
        else gsapValue = parseFloat(gsapValue) || 0;
        break;
      case "opacity":
        gsapKey = animeKey;
        break;
      case "clipPath":
        gsapKey = "clipPath";
        break;
      default:
        return null;
    }
    return { key: gsapKey, value: gsapValue };
  }

  function mapEasingToGsap(easingName) {
    var name = String(easingName || "easeOutCubic").trim();
    switch (name) {
      case "none":
      case "linear": return "none";
      case "easeInQuad": return "power1.in";
      case "easeOutQuad": return "power1.out";
      case "easeInOutQuad": return "power1.inOut";
      case "easeInCubic": return "power2.in";
      case "easeOutCubic": return "power2.out";
      case "easeInOutCubic": return "power2.inOut";
      case "easeInQuart": return "power3.in";
      case "easeOutQuart": return "power3.out";
      case "easeInOutQuart": return "power3.inOut";
      case "easeInQuint": return "power4.in";
      case "easeOutQuint": return "power4.out";
      case "easeInOutQuint": return "power4.inOut";
      case "easeInSine": return "sine.in";
      case "easeOutSine": return "sine.out";
      case "easeInOutSine": return "sine.inOut";
      case "easeInExpo": return "expo.in";
      case "easeOutExpo": return "expo.out";
      case "easeInOutExpo": return "expo.inOut";
      case "easeInCirc": return "circ.in";
      case "easeOutCirc": return "circ.out";
      case "easeInOutCirc": return "circ.inOut";
      case "easeInBack": return "back.in";
      case "easeOutBack": return "back.out";
      case "easeInOutBack": return "back.inOut";
      case "easeInElastic": return "elastic.in";
      case "easeOutElastic": return "elastic.out";
      case "easeInOutElastic": return "elastic.inOut";
      case "easeInBounce": return "bounce.in";
      case "easeOutBounce": return "bounce.out";
      case "easeInOutBounce": return "bounce.inOut";
      default:
        if (/^(?:power[1-4]|back|elastic|bounce|sine|expo|circ)\.(?:in|out|inOut)$/.test(name)) return name;
        return "power2.out";
    }
  }

  function buildGsapVarsFromPptParams(params) {
    var fromVars = {};
    var toVars = {};

    // duration/delay in the PPT API are milliseconds; GSAP uses seconds.
    if (params.duration) {
      var duration = Number(params.duration);
      if (Number.isFinite(duration)) toVars.duration = duration / 1000;
    }
    if (params.delay) {
      if (typeof params.delay === "function") {
        toVars.delay = params.delay;
      } else {
        var delay = Number(params.delay);
        if (Number.isFinite(delay)) toVars.delay = delay / 1000;
      }
    }

    if (params.easing || params.ease) {
      toVars.ease = mapEasingToGsap(params.easing || params.ease);
    }

    if (params.loop === true) {
      toVars.repeat = -1;
    } else if (typeof params.loop === "number" && params.loop > 0) {
      toVars.repeat = params.loop;
    }

    if (params.alternate) toVars.yoyo = true;

    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (key === "targets" || key === "duration" || key === "easing" || key === "ease" ||
          key === "delay" || key === "begin" || key === "complete" ||
          key === "loop" || key === "alternate" || key === "reversed" ||
          key === "keyframes" || key === "direction") return;

      if (Array.isArray(value) && value.length >= 3 && value[0] === value[value.length - 1]) {
        var looped = translateAnimKey(key);
        if (looped) {
          fromVars[looped.key] = value[0];
          toVars[looped.key] = value[1];
          if (toVars.repeat === undefined) toVars.repeat = 1;
          if (toVars.yoyo === undefined) toVars.yoyo = true;
        }
      } else if (Array.isArray(value) && value.length >= 2) {
        var translated = translateAnimKey(key);
        if (translated) {
          fromVars[translated.key] = value[0];
          toVars[translated.key] = value[1];
        }
      } else if (typeof value === "number" || typeof value === "string") {
        var single = translateAnimKey(key);
        if (single) {
          toVars[single.key] = value;
        }
      }
    });

    return { fromVars: fromVars, toVars: toVars };
  }

  function trackActiveGsapTween(tween) {
    if (!tween) return tween;
    trackPrintTask(tween);
    _activeAnimations.add(tween);
    if (typeof tween.then === "function") {
      tween.then(function () { _activeAnimations.delete(tween); }, function () { _activeAnimations.delete(tween); });
    }
    return tween;
  }

  function isGsapExitOpacityTween(vars) {
    return vars && vars.fromVars && vars.toVars &&
      vars.fromVars.opacity === 1 && vars.toVars.opacity === 0;
  }

  function addGsapTweenToTimeline(timeline, gsapInst, targets, vars, position) {
    if (isGsapExitOpacityTween(vars)) {
      if (timeline && typeof timeline.to === "function") {
        timeline.to(targets, vars.toVars, position);
        return;
      }
      var exitTween = gsapInst.to(targets, vars.toVars);
      trackActiveGsapTween(exitTween);
      if (timeline && typeof timeline.add === "function") timeline.add(exitTween, position);
      return;
    }

    if (timeline && typeof timeline.fromTo === "function") {
      timeline.fromTo(targets, vars.fromVars, vars.toVars, position);
      return;
    }

    var tween = gsapInst.fromTo(targets, vars.fromVars, vars.toVars);
    trackActiveGsapTween(tween);
    if (timeline && typeof timeline.add === "function") timeline.add(tween, position);
  }

  function animateWithGsap(gsapInst, args) {
    var targets = args[0];
    var params = args[1];
    if (!targets || !params || typeof params !== "object") return createCompletedAnimationStub();

    var vars = buildGsapVarsFromPptParams(params);
    var fromVars = vars.fromVars;
    var toVars = vars.toVars;

    var tween;
    // For exit animations where opacity goes 1→0, use gsap.to
    if (isGsapExitOpacityTween(vars)) {
      tween = gsapInst.to(targets, toVars);
    } else {
      tween = gsapInst.fromTo(targets, fromVars, toVars);
    }

    return trackActiveGsapTween(tween);
  }

  ppt.animate = function () {
    var args = Array.prototype.slice.call(arguments);
    if (isPrintMode) {
      var rawTargets = args[0];
      var rawParams = args[1];
      if (args.length === 1 && rawTargets && typeof rawTargets === "object" && rawTargets.targets) {
        rawParams = rawTargets;
        rawTargets = rawTargets.targets;
      }
      applyPrintAnimationEndState(rawTargets, rawParams);
      return createCompletedAnimationStub();
    }

    // Prefer GSAP as primary animation engine
    var gsapInst = resolveGsap();
    if (gsapInst && typeof gsapInst.fromTo === "function") {
      return animateWithGsap(gsapInst, args);
    }

    // Fallback to anime.js
    var runtimeAnime = resolveAnime();
    var animation = null;
    if (runtimeAnime && typeof runtimeAnime.animate === "function") {
      animation = runtimeAnime.animate.apply(runtimeAnime, args);
    } else if (typeof runtimeAnime === "function") {
      animation = runtimeAnime.apply(null, args);
    } else {
      throw new Error("GSAP 或 anime.js v4 未就绪，无法执行 PPT.animate");
    }
    if (animation && animation.finished && typeof animation.finished.then === "function") {
      trackPrintTask(animation.finished);
    }
    if (animation && typeof animation.pause === "function") {
      _activeAnimations.add(animation);
      var origFinished = animation.finished;
      if (origFinished && typeof origFinished.then === "function") {
        origFinished.then(
          function () { _activeAnimations.delete(animation); },
          function () { _activeAnimations.delete(animation); }
        );
      }
    }
    return animation;
  };

  ppt.stagger = function () {
    var gsapInst = resolveGsap();
    var args = Array.prototype.slice.call(arguments);
    // GSAP timeline stagger is natively handled via gsap.utils.stagger
    if (gsapInst && typeof gsapInst.utils === "object" && typeof gsapInst.utils.stagger === "function") {
      var gapMs = Number(args[0] || 0);
      var normalizedArgs = [Number.isFinite(gapMs) ? gapMs / 1000 : 0];
      if (args[1] && typeof args[1] === "object") {
        var options = Object.assign({}, args[1]);
        if (options.start !== undefined) {
          var startMs = Number(options.start);
          if (Number.isFinite(startMs)) options.start = startMs / 1000;
        }
        normalizedArgs.push(options);
      }
      return gsapInst.utils.stagger.apply(gsapInst.utils, normalizedArgs);
    }
    var runtimeAnime = resolveAnime();
    if (runtimeAnime && typeof runtimeAnime.stagger === "function") {
      return runtimeAnime.stagger.apply(runtimeAnime, args);
    }
    return buildStagger.apply(null, args);
  };

  ppt.createTimeline = function () {
    var gsapInst = resolveGsap();
    var args = Array.prototype.slice.call(arguments);
    if (gsapInst && typeof gsapInst.timeline === "function") {
      var timeline = gsapInst.timeline.apply(gsapInst, args);
      trackActiveGsapTween(timeline);
      return {
        add: function (params, position) {
          if (!params || typeof params !== "object") {
            if (timeline && typeof timeline.add === "function") timeline.add(params, position);
            return this;
          }
          var targets = params.targets;
          if (!targets) return this;
          var tweenParams = Object.assign({}, params);
          delete tweenParams.targets;
          var vars = buildGsapVarsFromPptParams(tweenParams);
          addGsapTweenToTimeline(timeline, gsapInst, targets, vars, position);
          return this;
        },
        play: function () {
          if (timeline && typeof timeline.play === "function") timeline.play.apply(timeline, arguments);
          return this;
        },
        pause: function () {
          if (timeline && typeof timeline.pause === "function") timeline.pause.apply(timeline, arguments);
          return this;
        },
        restart: function () {
          if (timeline && typeof timeline.restart === "function") timeline.restart.apply(timeline, arguments);
          return this;
        },
        raw: timeline
      };
    }
    var runtimeAnime = resolveAnime();
    if (runtimeAnime && typeof runtimeAnime.createTimeline === "function") {
      return runtimeAnime.createTimeline.apply(runtimeAnime, args);
    }
    if (runtimeAnime && typeof runtimeAnime.timeline === "function") {
      return runtimeAnime.timeline.apply(runtimeAnime, args);
    }
    return buildTimeline(runtimeAnime).apply(null, args);
  };

  ppt.stopAnimations = function () {
    var gsapInst = resolveGsap();
    if (gsapInst && typeof gsapInst.globalTimeline === "object") {
      try { gsapInst.globalTimeline.pause(); } catch (_err) {}
    }
    _activeAnimations.forEach(function (anim) {
      try { if (typeof anim.pause === "function") anim.pause(); } catch (_err) {}
    });
  };

  ppt.finishAnimations = function () {
    var gsapInst = resolveGsap();
    if (gsapInst && typeof gsapInst.globalTimeline === "object") {
      try { gsapInst.globalTimeline.progress(1); } catch (_err) {}
    }
    _activeAnimations.forEach(function (anim) {
      try {
        if (typeof anim.complete === "function") {
          anim.complete();
          return;
        }
        if (typeof anim.totalProgress === "function") {
          anim.totalProgress(1);
          if (typeof anim.pause === "function") anim.pause();
          return;
        }
        if (typeof anim.progress === "function") {
          anim.progress(1);
          if (typeof anim.pause === "function") anim.pause();
          return;
        }
        var duration = typeof anim.duration === "function" ? Number(anim.duration()) : Number(anim.duration);
        if (typeof anim.seek === "function" && Number.isFinite(duration)) {
          anim.seek(duration);
        }
        if (typeof anim.pause === "function") anim.pause();
      } catch (_err) {}
    });
  };

  ppt.resumeAnimations = function () {
    var gsapInst = resolveGsap();
    if (gsapInst && typeof gsapInst.globalTimeline === "object") {
      try { gsapInst.globalTimeline.play(); } catch (_err) {}
    }
    _activeAnimations.forEach(function (anim) {
      try { if (typeof anim.play === "function") anim.play(); } catch (_err) {}
    });
  };

  ppt.clicks = {
    current: 0,
    total: 0,
    _listeners: [],
    _advanceListeners: [],
    reset: function () {
      this.current = 0;
    },
    _clearListeners: function () {
      this._listeners = [];
      this._advanceListeners = [];
    },
    setTotal: function (n) {
      this.total = Math.max(0, Number(n) || 0);
      if (this.current > this.total) this.current = this.total;
    },
    advance: function () {
      if (this.total > 0 && this.current >= this.total) return false;
      this.current += 1;
      this._dispatch(this.current);
      return true;
    },
    on: function (clickNum, fn) {
      this._listeners.push({ clickNum: clickNum, fn: fn });
      if (this.current >= clickNum) {
        try { fn(); } catch (_err) {}
      }
    },
    onAdvance: function (fn) {
      this._advanceListeners.push(fn);
    },
    _dispatch: function (click) {
      var self = this;
      this._listeners.forEach(function (entry) {
        if (entry.clickNum === click) {
          try { entry.fn(); } catch (_err) {}
        }
      });
      this._advanceListeners.forEach(function (fn) {
        try { fn(click, self.current, self.total); } catch (_err) {}
      });
    }
  };

  function isPlaybackBridgeEnabled() {
    try {
      var search = new URLSearchParams(global.location && global.location.search || "");
      return search.get("pptPlayback") === "1";
    } catch (_err) {
      return false;
    }
  }

  function isEditablePlaybackTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    return Boolean(target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable='']"));
  }

  function postPlaybackHandled(requestId) {
    if (!requestId) return;
    try {
      if (!global.parent || global.parent === global) return;
      global.parent.postMessage({
        type: "ohmyppt:playback:handled",
        requestId: requestId
      }, "*");
    } catch (_err) {}
  }

  function postPlaybackNavigation(offset, requestId) {
    try {
      if (!global.parent || global.parent === global) return;
      global.parent.postMessage({
        type: "ohmyppt:playback:goto",
        offset: offset || 1,
        requestId: requestId || null
      }, "*");
    } catch (_err) {}
  }

  function consumePlaybackStepOrNavigate(offset, requestId) {
    if (ppt.clicks && ppt.clicks.total > 0 && typeof ppt.clicks.advance === "function") {
      if (ppt.clicks.advance()) {
        postPlaybackHandled(requestId);
        return true;
      }
    }
    postPlaybackNavigation(offset || 1, requestId);
    return true;
  }

  function stopPlaybackEvent(event) {
    if (!event) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
  }

  function normalizePlaybackWheelDelta(event) {
    var delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= 900;
    return delta;
  }

  function installPlaybackBridge() {
    if (!isPlaybackBridgeEnabled() || global.__ohmypptPlaybackBridgeInstalled) return;
    var doc = global.document;
    if (!doc || typeof doc.addEventListener !== "function") return;
    global.__ohmypptPlaybackBridgeInstalled = true;
    var playbackBridgeInstallToken = (global.__ohmypptPlaybackBridgeInstallToken || 0) + 1;
    global.__ohmypptPlaybackBridgeInstallToken = playbackBridgeInstallToken;
    var wheelDeltaBuffer = 0;
    var wheelGestureLocked = false;
    var wheelGestureLockDirection = 0;
    var lastWheelNavigateAt = 0;
    var wheelGestureUnlockTimer = 0;
    var wheelNavigationRequestSeq = 0;
    var pendingWheelNavigationRequests = {};
    var WHEEL_NAV_THRESHOLD = 80;
    var WHEEL_NAV_COOLDOWN = 520;
    var WHEEL_GESTURE_IDLE = 260;

    function resetWheelGestureState() {
      wheelDeltaBuffer = 0;
      wheelGestureLocked = false;
      wheelGestureLockDirection = 0;
      lastWheelNavigateAt = 0;
    }

    function resetWheelGestureSoon() {
      if (wheelGestureUnlockTimer) global.clearTimeout(wheelGestureUnlockTimer);
      wheelGestureUnlockTimer = global.setTimeout(function () {
        wheelGestureUnlockTimer = 0;
        resetWheelGestureState();
      }, WHEEL_GESTURE_IDLE);
    }

    function nextWheelNavigationRequestId() {
      var requestId = "wheel-" + (++wheelNavigationRequestSeq);
      pendingWheelNavigationRequests[requestId] = true;
      return requestId;
    }

    function postWheelNavigation(offset) {
      postPlaybackNavigation(offset, nextWheelNavigationRequestId());
    }

    doc.addEventListener("click", function (event) {
      if (global.__ohmypptPlaybackBridgeInstallToken !== playbackBridgeInstallToken) return;
      if (isEditablePlaybackTarget(event.target)) return;
      stopPlaybackEvent(event);
      consumePlaybackStepOrNavigate(1);
    }, true);

    doc.addEventListener("keydown", function (event) {
      if (global.__ohmypptPlaybackBridgeInstallToken !== playbackBridgeInstallToken) return;
      if (isEditablePlaybackTarget(event.target)) return;
      var forwardKeys = ["ArrowRight", "ArrowDown", "PageDown", " "];
      var backKeys = ["ArrowLeft", "ArrowUp", "PageUp"];
      if (forwardKeys.indexOf(event.key) >= 0) {
        stopPlaybackEvent(event);
        consumePlaybackStepOrNavigate(1);
      } else if (backKeys.indexOf(event.key) >= 0) {
        stopPlaybackEvent(event);
        postPlaybackNavigation(-1);
      }
    }, true);

    doc.addEventListener("wheel", function (event) {
      if (global.__ohmypptPlaybackBridgeInstallToken !== playbackBridgeInstallToken) return;
      if (event.ctrlKey || event.metaKey) return;
      if (isEditablePlaybackTarget(event.target)) return;

      var delta = normalizePlaybackWheelDelta(event);
      if (!Number.isFinite(delta) || Math.abs(delta) < 1) return;
      var direction = delta > 0 ? 1 : -1;

      if (Math.sign(delta) !== Math.sign(wheelDeltaBuffer)) wheelDeltaBuffer = 0;
      wheelDeltaBuffer += delta;
      resetWheelGestureSoon();

      if (Math.abs(wheelDeltaBuffer) < WHEEL_NAV_THRESHOLD) return;

      if (wheelGestureLocked && wheelGestureLockDirection && direction !== wheelGestureLockDirection) {
        wheelGestureLocked = false;
        wheelGestureLockDirection = 0;
        lastWheelNavigateAt = 0;
      }

      if (wheelGestureLocked) {
        wheelDeltaBuffer = 0;
        stopPlaybackEvent(event);
        return;
      }

      var now = Date.now();
      if (now - lastWheelNavigateAt < WHEEL_NAV_COOLDOWN) {
        wheelDeltaBuffer = 0;
        wheelGestureLocked = true;
        wheelGestureLockDirection = direction;
        stopPlaybackEvent(event);
        return;
      }

      var offset = wheelDeltaBuffer > 0 ? 1 : -1;
      wheelDeltaBuffer = 0;
      wheelGestureLocked = true;
      wheelGestureLockDirection = offset;
      lastWheelNavigateAt = now;
      stopPlaybackEvent(event);
      if (offset > 0) {
        if (ppt.clicks && ppt.clicks.total > 0 && typeof ppt.clicks.advance === "function" && ppt.clicks.advance()) {
          return;
        }
        postWheelNavigation(1);
      } else {
        postWheelNavigation(-1);
      }
    }, { capture: true, passive: false });

    global.addEventListener("message", function (event) {
      if (global.__ohmypptPlaybackBridgeInstallToken !== playbackBridgeInstallToken) return;
      if (event.source && event.source !== global.parent) return;
      var data = event && event.data;
      if (!data) return;
      if (data.type === "ohmyppt:playback:navigation-result") {
        if (!data.requestId || !pendingWheelNavigationRequests[data.requestId]) return;
        delete pendingWheelNavigationRequests[data.requestId];
        if (!data.navigated) resetWheelGestureState();
        return;
      }
      if (data.type !== "ohmyppt:playback:advance") return;
      var offset = Number(data.offset);
      consumePlaybackStepOrNavigate(
        Number.isFinite(offset) && offset !== 0 ? offset : 1,
        data.requestId || null
      );
    });
  }

  installPlaybackBridge();

  var DATA_ANIM_TYPES = {
    "fade": true,
    "fade-up": true,
    "fade-down": true,
    "fade-left": true,
    "fade-right": true,
    "scale-in": true,
    "slide-up": true,
    "slide-down": true,
    "slide-left": true,
    "slide-right": true,
    "fly-in": true,
    "wipe": true,
    "zoom-in": true,
    "spin-in": true,
    "grow-shrink": true,
    "pulse": true,
    "exit-fade": true,
    "exit-wipe": true,
    "exit-fly": true,
    "path": true,
    "lottie": true
  };

  var DATA_ANIM_ENTRANCE_TYPES = {
    "fade": true,
    "fade-up": true,
    "fade-down": true,
    "fade-left": true,
    "fade-right": true,
    "scale-in": true,
    "slide-up": true,
    "slide-down": true,
    "slide-left": true,
    "slide-right": true,
    "fly-in": true,
    "wipe": true,
    "zoom-in": true,
    "spin-in": true
  };

  var DATA_ANIM_INITIAL_STYLES = {
    "fade":       { opacity: "0" },
    "fade-up":    { opacity: "0", transform: "translateY(20px)" },
    "fade-down":  { opacity: "0", transform: "translateY(-20px)" },
    "fade-left":  { opacity: "0", transform: "translateX(20px)" },
    "fade-right": { opacity: "0", transform: "translateX(-20px)" },
    "scale-in":   { opacity: "0", transform: "scale(0.85)" },
    "slide-up":   { opacity: "0", transform: "translateY(40px)" },
    "slide-down": { opacity: "0", transform: "translateY(-40px)" },
    "slide-left": { opacity: "0", transform: "translateX(40px)" },
    "slide-right": { opacity: "0", transform: "translateX(-40px)" },
    "zoom-in":    { opacity: "0", transform: "scale(0.75)" },
    "spin-in":    { opacity: "0", transform: "rotate(-12deg) scale(0.92)" }
  };

  function normalizeDataAnimType(type) {
    var normalized = String(type || "fade-up").trim().toLowerCase();
    if (normalized === "none") return "none";
    if (normalized === "fly" || normalized === "flyin") return "fly-in";
    if (normalized === "zoom" || normalized === "zoomin") return "zoom-in";
    if (normalized === "spin" || normalized === "spinin") return "spin-in";
    if (normalized === "grow" || normalized === "growshrink") return "grow-shrink";
    if (normalized === "emphasis") return "pulse";
    if (DATA_ANIM_TYPES[normalized]) return normalized;
    return "fade-up";
  }

  function normalizeAnimTrigger(trigger) {
    var normalized = String(trigger || "load").trim().toLowerCase();
    if (normalized === "on-click") return "click";
    if (normalized === "after-previous") return "after";
    if (normalized === "with-previous") return "with";
    if (normalized === "click" || normalized === "load" || normalized === "with" || normalized === "after") {
      return normalized;
    }
    return "load";
  }

  function normalizeAnimSequence(sequence) {
    var normalized = String(sequence || "").trim().toLowerCase();
    if (normalized === "after-previous") return "after";
    if (normalized === "with-previous") return "with";
    if (normalized === "with" || normalized === "after") return normalized;
    return "";
  }

  function normalizeAnimSide(side, fallback) {
    var normalized = String(side || fallback || "bottom").trim().toLowerCase();
    if (normalized === "up" || normalized === "top") return "top";
    if (normalized === "down" || normalized === "bottom") return "bottom";
    if (normalized === "start") return "left";
    if (normalized === "end") return "right";
    if (normalized === "left" || normalized === "right" || normalized === "center") return normalized;
    return fallback || "bottom";
  }

  function defaultAnimSideForType(type) {
    switch (type) {
      case "fade-up":
      case "slide-up":
        return "bottom";
      case "fade-down":
      case "slide-down":
        return "top";
      case "fade-left":
      case "slide-left":
        return "right";
      case "fade-right":
      case "slide-right":
        return "left";
      case "wipe":
      case "exit-wipe":
        return "left";
      default:
        return "bottom";
    }
  }

  function getSideOffset(side, distance) {
    switch (normalizeAnimSide(side, "bottom")) {
      case "left":
        return { x: -distance, y: 0 };
      case "right":
        return { x: distance, y: 0 };
      case "top":
        return { x: 0, y: -distance };
      case "center":
        return { x: 0, y: 0, scale: 0.9 };
      case "bottom":
      default:
        return { x: 0, y: distance };
    }
  }

  function getWipeClipPath(side, visible) {
    if (visible) return "inset(0% 0% 0% 0%)";
    switch (normalizeAnimSide(side, "left")) {
      case "right":
        return "inset(0% 0% 0% 100%)";
      case "top":
        return "inset(0% 0% 100% 0%)";
      case "bottom":
        return "inset(100% 0% 0% 0%)";
      case "center":
        return "inset(20% 20% 20% 20%)";
      case "left":
      default:
        return "inset(0% 100% 0% 0%)";
    }
  }

  function getInitialDataAnimStyle(type, from) {
    if (!DATA_ANIM_ENTRANCE_TYPES[type]) return null;
    if (type === "fly-in") {
      var fly = getSideOffset(from, 40);
      if (fly.scale) return { opacity: "0", transform: "scale(" + fly.scale + ")" };
      if (fly.x) return { opacity: "0", transform: "translateX(" + fly.x + "px)" };
      return { opacity: "0", transform: "translateY(" + fly.y + "px)" };
    }
    if (type === "wipe") {
      return { opacity: "0", clipPath: getWipeClipPath(from, false) };
    }
    return DATA_ANIM_INITIAL_STYLES[type] || DATA_ANIM_INITIAL_STYLES["fade-up"];
  }

  function applyInitialHiddenState(el, type, from) {
    var initial = getInitialDataAnimStyle(type, from);
    if (!initial) return false;
    if (initial.opacity !== undefined) el.style.opacity = initial.opacity;
    if (initial.clipPath) el.style.clipPath = initial.clipPath;
    // Compose with existing transform so Tailwind classes survive
    if (initial.transform) {
      var existing = (el.style.transform || "").trim();
      el.style.transform = existing ? existing + " " + initial.transform : initial.transform;
    }
    return true;
  }

  function normalizeAnimRepeat(repeat) {
    var raw = String(repeat || "").trim().toLowerCase();
    if (!raw || raw === "1" || raw === "false") return null;
    if (raw === "infinite" || raw === "loop" || raw === "true") return true;
    var count = Number(raw);
    if (!Number.isFinite(count) || count <= 1) return null;
    return Math.min(20, Math.floor(count));
  }

  function applyRepeatDirectionParams(params, animDef) {
    if (animDef.repeat === true) {
      params.loop = true;
    } else if (Number.isFinite(animDef.repeat) && animDef.repeat > 1) {
      params.loop = animDef.repeat - 1;
    }

    if (animDef.direction === "alternate") {
      params.alternate = true;
    } else if (animDef.direction === "reverse") {
      params.reversed = true;
    }
  }

  function parseMotionPathDelta(path) {
    var raw = String(path || "").trim();
    if (!raw) return null;
    var coords = raw.match(/-?\d+(?:\.\d+)?/g);
    if (!coords || coords.length < 4) return null;
    var startX = Number(coords[0]);
    var startY = Number(coords[1]);
    var endX = Number(coords[coords.length - 2]);
    var endY = Number(coords[coords.length - 1]);
    if (![startX, startY, endX, endY].every(Number.isFinite)) return null;
    return { x: endX - startX, y: endY - startY };
  }

  function scanDataAnimElements(root) {
    ppt.clicks.reset();
    ppt.clicks._clearListeners();

    var elements = Array.from((root || document).querySelectorAll("[data-anim]"));
    if (elements.length === 0) {
      ppt.clicks.setTotal(0);
      return null;
    }

    var animConfigs = [];
    // Per-trigger-group counters for stagger(N) → numeric delay
    var staggerCounters = {};
    var lastSequenceStart = 0;
    var lastSequenceEnd = 0;

    elements.forEach(function (el, index) {
      var type = normalizeDataAnimType(el.getAttribute("data-anim") || "fade-up");
      if (type === "none") return;

      var trigger = normalizeAnimTrigger(el.getAttribute("data-anim-trigger") || "load");
      var effectiveTrigger = trigger === "click" ? "click" : "load";
      var sequence = normalizeAnimSequence(el.getAttribute("data-anim-sequence") || "");
      var from = normalizeAnimSide(el.getAttribute("data-anim-from"), defaultAnimSideForType(type));
      var duration = Number(el.getAttribute("data-anim-duration")) || 500;
      var easing = (el.getAttribute("data-anim-easing") || "easeOutCubic").trim();
      var delayRaw = (el.getAttribute("data-anim-delay") || "0").trim();
      var staggerAttr = (el.getAttribute("data-anim-stagger") || "").trim();
      var delay = 0;
      var boundedDuration = Math.max(100, Math.min(5000, duration));

      if (staggerAttr) {
        var gap = Number(staggerAttr) || 50;
        var groupKey = effectiveTrigger;
        if (staggerCounters[groupKey] === undefined) staggerCounters[groupKey] = 0;
        delay = staggerCounters[groupKey] * gap;
        staggerCounters[groupKey] += 1;
      } else if (delayRaw.indexOf("stagger") === 0) {
        var match = delayRaw.match(/stagger\s*\(\s*(\d+)\s*\)/);
        var gap = match ? Number(match[1]) : 50;
        var groupKey = effectiveTrigger;
        if (staggerCounters[groupKey] === undefined) staggerCounters[groupKey] = 0;
        delay = staggerCounters[groupKey] * gap;
        staggerCounters[groupKey] += 1;
      } else {
        delay = Number(delayRaw) || 0;
      }

      var sequencingMode = effectiveTrigger === "load" ? (sequence || trigger) : trigger;

      if (effectiveTrigger === "load") {
        if (sequencingMode === "after") {
          delay += lastSequenceEnd;
          lastSequenceStart = delay;
          lastSequenceEnd = Math.max(lastSequenceEnd, delay + boundedDuration);
        } else if (sequencingMode === "with") {
          delay += lastSequenceStart;
          lastSequenceEnd = Math.max(lastSequenceEnd, delay + boundedDuration);
        } else {
          lastSequenceStart = delay;
          lastSequenceEnd = Math.max(lastSequenceEnd, delay + boundedDuration);
        }
      }

      if (trigger === "click" && type !== "lottie") {
        if (applyInitialHiddenState(el, type, from)) {
          el.setAttribute("data-ppt-anim-initialized", "1");
        }
      }

      var animDef = {
        targets: el,
        type: type,
        trigger: trigger,
        effectiveTrigger: effectiveTrigger,
        from: from,
        duration: boundedDuration,
        easing: easing,
        delay: delay,
        sequence: effectiveTrigger === "load" && sequence ? sequence : undefined,
        stagger: staggerAttr ? Math.max(1, Number(staggerAttr) || 50) : undefined,
        repeat: normalizeAnimRepeat(el.getAttribute("data-anim-repeat")),
        direction: (el.getAttribute("data-anim-direction") || "normal").trim().toLowerCase(),
        path: (el.getAttribute("data-anim-path") || "").trim(),
        order: index
      };

      // Lottie hook — parse additional attributes, store in config.
      if (type === "lottie") {
        animDef.lottieSrc = (el.getAttribute("data-anim-lottie-src") || "").trim();
        animDef.lottieLoop = el.getAttribute("data-anim-lottie-loop") !== "false";
        animDef.lottieAutoplay = el.getAttribute("data-anim-lottie-autoplay") !== "false";
      }

      animConfigs.push(animDef);
    });

    var loadAnims = animConfigs.filter(function (a) { return a.effectiveTrigger === "load"; });
    var clickAnims = animConfigs.filter(function (a) { return a.effectiveTrigger === "click"; });

    ppt.clicks.setTotal(clickAnims.length);

    return { load: loadAnims, click: clickAnims, all: animConfigs };
  }

  function executeDataAnimConfig(config) {
    if (!config || config.length === 0) return;

    config.forEach(function (animDef) {
      // Lottie hook — delegate to dedicated player when available.
      // Falls through to no-op until lottie runtime is injected.
      if (animDef.type === "lottie") {
        if (typeof ppt.playLottie === "function") {
          ppt.playLottie(animDef.targets, animDef);
        }
        return;
      }

      var params = {
        duration: animDef.duration,
        easing: animDef.easing,
        delay: animDef.delay
      };
      applyRepeatDirectionParams(params, animDef);

      var motionPathDelta = parseMotionPathDelta(animDef.path);

      switch (animDef.type) {
        case "fade":
          params.opacity = [0, 1];
          break;
        case "fade-up":
          params.opacity = [0, 1];
          params.translateY = [20, 0];
          break;
        case "fade-down":
          params.opacity = [0, 1];
          params.translateY = [-20, 0];
          break;
        case "fade-left":
          params.opacity = [0, 1];
          params.translateX = [20, 0];
          break;
        case "fade-right":
          params.opacity = [0, 1];
          params.translateX = [-20, 0];
          break;
        case "scale-in":
          params.opacity = [0, 1];
          params.scale = [0.85, 1];
          break;
        case "slide-up":
          params.opacity = [0, 1];
          params.translateY = [40, 0];
          break;
        case "slide-down":
          params.opacity = [0, 1];
          params.translateY = [-40, 0];
          break;
        case "slide-left":
          params.opacity = [0, 1];
          params.translateX = [40, 0];
          break;
        case "slide-right":
          params.opacity = [0, 1];
          params.translateX = [-40, 0];
          break;
        case "fly-in": {
          var fly = getSideOffset(animDef.from, 40);
          params.opacity = [0, 1];
          if (fly.scale) {
            params.scale = [fly.scale, 1];
          } else if (fly.x) {
            params.translateX = [fly.x, 0];
          } else {
            params.translateY = [fly.y, 0];
          }
          break;
        }
        case "wipe":
          params.opacity = [0, 1];
          params.clipPath = [getWipeClipPath(animDef.from, false), getWipeClipPath(animDef.from, true)];
          break;
        case "zoom-in":
          params.opacity = [0, 1];
          params.scale = [0.75, 1];
          break;
        case "spin-in":
          params.opacity = [0, 1];
          params.rotate = [-12, 0];
          params.scale = [0.92, 1];
          break;
        case "grow-shrink":
          params.scale = [0.9, 1.08, 1];
          break;
        case "pulse":
          params.scale = [1, 1.06, 1];
          break;
        case "exit-fade":
          params.opacity = [1, 0];
          break;
        case "exit-wipe":
          params.opacity = [1, 0];
          params.clipPath = [getWipeClipPath(animDef.from, true), getWipeClipPath(animDef.from, false)];
          break;
        case "exit-fly": {
          var exitFly = getSideOffset(animDef.from, 40);
          params.opacity = [1, 0];
          if (exitFly.x) {
            params.translateX = [0, exitFly.x];
          } else if (exitFly.y) {
            params.translateY = [0, exitFly.y];
          } else {
            params.scale = [1, 0.9];
          }
          break;
        }
        default:
          if (motionPathDelta) {
            params.translateX = [0, motionPathDelta.x];
            params.translateY = [0, motionPathDelta.y];
          } else {
            params.opacity = [0, 1];
            params.translateY = [20, 0];
          }
      }

      if (motionPathDelta && !params.translateX && !params.translateY) {
        params.translateX = [0, motionPathDelta.x];
        params.translateY = [0, motionPathDelta.y];
      }

      // Unified path: print-mode, task tracking, stopAnimations()
      ppt.animate(animDef.targets, params);
    });
  }

  // no-op until lottie-web injected
  ppt.playLottie = function (_el, _animDef) {};

  ppt.scanDataAnim = function (root) {
    return scanDataAnimElements(root);
  };

  ppt.executeDataAnim = function (config) {
    return executeDataAnimConfig(config);
  };

  ppt.createChart = function (target, config) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行 PPT.createChart");
    }
    var targetInfo = resolveChartTarget(target);
    var canvas = targetInfo.canvas;
    var chartTarget = targetInfo.chartTarget;
    if (!chartTarget) {
      throw new Error("PPT.createChart 目标无效，未找到 canvas");
    }
    var existing = resolveChartInstance(ChartCtor, chartTarget, canvas);
    if (existing && typeof existing.destroy === "function") {
      try { existing.destroy(); } catch (_err) {}
    }
    var chart = new ChartCtor(chartTarget, withPrintChartConfig(config));
    var key = canvas || (chart && chart.canvas) || null;
    if (key) getChartRegistry().set(key, chart);
    markChartReady(chart);
    return chart;
  };

  ppt.updateChart = function (target, patch) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行1nicscra PPT.updateChart");
    }
    var targetInfo = resolveChartTarget(target);
    var canvas = targetInfo.canvas;
    var chartTarget = targetInfo.chartTarget;
    var chart = resolveChartInstance(ChartCtor, chartTarget, canvas);
    if (!chart) {
      throw new Error("PPT.updateChart 未找到对应图表实例arcsin1");
    }
    if (typeof patch === "function") {
      patch(chart);
    } else if (patch && typeof patch === "object") {
      if (Object.prototype.hasOwnProperty.call(patch, "data")) chart.data = normalizeChartData(patch.data);
      if (Object.prototype.hasOwnProperty.call(patch, "options")) {
        var patchedConfig = { data: chart.data, options: patch.options };
        ensureChartNumberFormatters(patchedConfig);
        chart.options = patchedConfig.options;
      }
    }
    if (typeof chart.update === "function") {
      var mode = patch && typeof patch === "object" ? patch.mode : undefined;
      chart.update(mode);
    }
    markChartReady(chart);
    return chart;
  };

  ppt.destroyChart = function (target) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行 PPT.destroyChart-1nicscra");
    }
    var targetInfo = resolveChartTarget(target);
    var canvas = targetInfo.canvas;
    var chartTarget = targetInfo.chartTarget;
    var chart = resolveChartInstance(ChartCtor, chartTarget, canvas);
    if (!chart) return false;
    try { chart.destroy(); } catch (_err) {}
    if (canvas) getChartRegistry().delete(canvas);
    return true;
  };

  ppt.resizeCharts = function (target) {
    var ChartCtor = global.Chart;
    if (typeof ChartCtor !== "function") {
      throw new Error("Chart.js v4 未就绪，无法执行arcsin1 PPT.resizeCharts-1nicscra");
    }
    if (target !== undefined && target !== null) {
      var targetInfo = resolveChartTarget(target);
      var chart = resolveChartInstance(ChartCtor, targetInfo.chartTarget, targetInfo.canvas);
      if (!chart || typeof chart.resize !== "function") return 0;
      chart.resize();
      return 1;
    }
    var charts = collectChartInstances(ChartCtor);
    var count = 0;
    charts.forEach(function (chart) {
      if (chart && typeof chart.resize === "function") {
        chart.resize();
        count += 1;
      }
    });
    return count;
  };

  ppt.renderMath = function (root) {
    return trackPrintTask(renderMath(root));
  };

  function autoRenderMathWhenReady() {
    if (!global.document) return;
    var run = function () {
      ppt.renderMath(document.querySelector(".ppt-page-content") || document.body);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  }

  ppt.whenReadyForPrint = function (timeoutMs) {
    var timeout = Math.max(0, Number(timeoutMs) || 5000);
    var startAt = Date.now();

    function waitDomReady() {
      if (!global.document || document.readyState === "complete" || document.readyState === "interactive") {
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", function onReady() {
          document.removeEventListener("DOMContentLoaded", onReady);
          resolve();
        });
      });
    }

    function drainPending() {
      var snapshot = pendingPrintTasks.slice();
      if (snapshot.length === 0) return Promise.resolve();
      return Promise.allSettled(snapshot).then(function () {
        if (pendingPrintTasks.length > 0 && (Date.now() - startAt) < timeout) {
          return drainPending();
        }
      });
    }

    return Promise.race([
      waitDomReady().then(function () {
        return drainPending().then(function () {
          return waitFrames(2);
        });
      }),
      new Promise(function (resolve) {
        setTimeout(function () { resolve(); }, timeout);
      }),
    ]);
  };

  autoRenderMathWhenReady();

  if (isPrintMode) {
    ppt.whenReadyForPrint(printTimeoutMs).then(function () {
      emitPrintReadyOnce();
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
