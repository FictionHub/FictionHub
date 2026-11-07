import { initAmbientGlow, startAmbientGlow } from '../ui/glow.js';

window.play = (raw, videoId) => {
    const run = () => {
        const ready = () =>
            document.getElementById('v') &&
            document.getElementById('player-controls-wrapper') &&
            document.getElementById('center-flash') &&
            document.getElementById('subtitle-display') &&
            document.getElementById('subtitle-text');

        if (ready()) { _vylaPlayReady(raw, videoId); return; }

        const deadline = Date.now() + 20000;
        const poll = setInterval(() => {
            if (ready()) {
                clearInterval(poll);
                _vylaPlayReady(raw, videoId);
            } else if (Date.now() > deadline) {
                clearInterval(poll);
                console.error('window.play: required player DOM never appeared');
            }
        }, 100);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
        run();
    }
};

function _vylaPlayReady(raw, videoId) {
    try {
        var blockedIdsRequest = new XMLHttpRequest();
        blockedIdsRequest.open('GET', 'src/blocked-ids.json', false);
        blockedIdsRequest.send();
        if (blockedIdsRequest.status === 200) {
            var blockedData = JSON.parse(blockedIdsRequest.responseText);
            if (blockedData.blockedIds && blockedData.blockedIds.some(function (id) { return String(id) === String(videoId); })) {
                var errorMessage = blockedData.dmcaMessage || 'DMCA takedown - this content can no longer be played';

                var controlsWrapper = document.getElementById('player-controls-wrapper');
                var titleBar = document.getElementById('title-bar');
                var player = document.getElementById('player');
                var loader = document.getElementById('loader');
                var bufferingSpinner = document.getElementById('buffering-spinner');

                if (controlsWrapper) controlsWrapper.style.display = 'none';
                if (titleBar) titleBar.style.display = 'none';
                if (player) player.classList.remove('ui-on');
                if (loader) loader.style.display = 'none';
                if (bufferingSpinner) bufferingSpinner.style.display = 'none';

                var errText = document.querySelector('.err-text');
                var errSub = document.querySelector('.err-sub');
                if (errText) errText.textContent = 'Content Blocked';
                if (!errSub && errText) {
                    errText.insertAdjacentHTML('afterend', '<div class="err-sub"></div>');
                    errSub = document.querySelector('.err-sub');
                }
                if (errSub) {
                    errSub.textContent = errorMessage;
                }
                var errScreen = document.getElementById('error-screen');
                if (errScreen) errScreen.classList.add('show');

                return;
            }
        }
    } catch (err) {
        console.log('Error checking blocked IDs:', err);
    }

    (function () {
        if (document.getElementById('_vyla_styles')) return;
        var st = document.createElement('style');
        st.id = '_vyla_styles';
        st.textContent = '@keyframes _vyla_spin{to{transform:rotate(360deg)}}@keyframes _vyla_dot{0%,80%,100%{transform:scale(0.55);opacity:0.25}40%{transform:scale(1);opacity:1}}';
        document.head.appendChild(st);
    })();

    var src = raw;
    var v = document.getElementById('v');
    if (!window._ambientGlowStarted) {
        window._ambientGlowStarted = true;
        initAmbientGlow();
        startAmbientGlow();
    }
    window._activeMediaUrl = src;

    (function () {
        if (v._vylaHooked) return;
        v._vylaHooked = true;
        var _origSetSrc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        Object.defineProperty(v, 'src', {
            get: function () { return _origSetSrc.get.call(v); },
            set: function (val) {
                _origSetSrc.set.call(v, val);
            },
            configurable: true
        });

        var _origLoad = v.load.bind(v);
        v.load = function () {
            return _origLoad();
        };

        var _origPlay = v.play.bind(v);
        v.play = function () {
            return _origPlay();
        };
    })();

    var controlsWrapper = document.getElementById('player-controls-wrapper');
    var titleBar = document.getElementById('title-bar');
    var titleText = document.getElementById('title-text');
    if (titleText) {
        titleText.style.cursor = 'pointer';
        titleText.addEventListener('click', function (e) {
            e.stopPropagation();
            if (window.history.length > 1) {
                window.history.back();
            }
        });
    }
    var trackEl = document.getElementById('track');

    var wrap = document.getElementById('track-wrap');
    var prog = document.getElementById('prog');
    var bufEl = document.getElementById('buf');
    var thumb = document.getElementById('thumb');
    var tCur = document.getElementById('t-cur');
    var tDur = document.getElementById('t-dur');
    var tdCur = document.getElementById('td-cur');
    var tdDur = document.getElementById('td-dur');
    var ci = document.getElementById('ci');
    var centerFlash = document.getElementById('center-flash');
    var cfSkipLeft = document.getElementById('cf-skip-left');
    var cfSkipRight = document.getElementById('cf-skip-right');

    cfSkipLeft.addEventListener('click', function (e) {
        e.stopPropagation();
        v.currentTime = Math.max(0, v.currentTime - 10);
        window.haptic();
    });
    cfSkipLeft.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        v.currentTime = Math.max(0, v.currentTime - 10);
        window.haptic();
    }, { passive: false });

    cfSkipRight.addEventListener('click', function (e) {
        e.stopPropagation();
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
        window.haptic();
    });
    cfSkipRight.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
        window.haptic();
    }, { passive: false });

    var _touchTapGuard = false;
    function togglePlaybackFromControl(e, targetVideo) {
        if (e && e.type === 'click' && _touchTapGuard) {
            _touchTapGuard = false;
            return;
        }
        if (e) {
            try { e.preventDefault(); } catch (ex) { }
            try { e.stopPropagation(); } catch (ex) { }
        }
        if (e && e.type === 'touchend') {
            _touchTapGuard = true;
            setTimeout(function () { _touchTapGuard = false; }, 350);
        }
        window.haptic();
        var _v = targetVideo || document.getElementById('v') || v;
        try { _v.playbackRate = savedSpeed; } catch (ex) { }
        _suppressBoostUntil = Date.now() + 800;
        clearTimeout(_speedBoostTimer);
        _speedBoostTimer = null;
        isPressing = false;
        _boostDidActivate = false;
        if (_v.paused) {
            _v.play().catch(function () { });
        } else {
            _v.pause();
        }
    }

    ci.style.position = 'relative';
    ci.style.zIndex = '20';
    ci.style.pointerEvents = 'auto';
    ci.style.touchAction = 'manipulation';
    ci.style.webkitTapHighlightColor = 'transparent';
    ci.addEventListener('click', function (e) {
        togglePlaybackFromControl(e, v);
    });
    ci.addEventListener('touchend', function (e) {
        togglePlaybackFromControl(e, v);
    }, { passive: false });

    centerFlash.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.cf-skip-btn')) return;
        togglePlaybackFromControl(e, v);
    });
    centerFlash.addEventListener('touchend', function (e) {
        if (e.target && e.target.closest && e.target.closest('.cf-skip-btn')) return;
        togglePlaybackFromControl(e, v);
    }, { passive: false });

    var btnPlay = document.getElementById('btn-play');
    if (btnPlay) {
        btnPlay.style.position = 'relative';
        btnPlay.style.zIndex = '20';
        btnPlay.style.pointerEvents = 'auto';
        btnPlay.addEventListener('click', function (e) {
            togglePlaybackFromControl(e, v);
        });
        btnPlay.addEventListener('touchend', function (e) {
            togglePlaybackFromControl(e, v);
        }, { passive: false });
    }

    var skipL = document.getElementById('skip-left');
    var skipR = document.getElementById('skip-right');
    var skipLLbl = document.getElementById('skip-left-lbl');
    var skipRLbl = document.getElementById('skip-right-lbl');
    var btnPip = document.getElementById('btn-pip');
    var btnFullscreen = document.getElementById('btn-fullscreen');
    var btnSettings = document.getElementById('btn-settings');
    var settingsPanel = document.getElementById('settings-panel');
    var speedOpts = document.querySelectorAll('.settings-list-item[data-speed]');
    var qualityOptsEl = document.getElementById('quality-opts');
    var sourceBtnWrap = document.getElementById('source-title-wrap');
    var subFontSelect = document.getElementById('sub-font-select');
    var subSizeSelect = document.getElementById('sub-size-select');
    var subColorInput = document.getElementById('sub-color-input');
    var subBgColorInput = document.getElementById('sub-bg-color-input');
    var subBgOpacitySelect = document.getElementById('sub-bg-opacity-select');
    var subPosSelect = document.getElementById('sub-pos-select');
    var subEdgeSelect = document.getElementById('sub-edge-select');
    var subtitleDisplay = document.getElementById('subtitle-display');
    var subtitleText = document.getElementById('subtitle-text');
    var tooltip = document.getElementById('tooltip');

    var volSlider = document.getElementById('volume-slider');
    var volIcon = document.getElementById('volume-icon');
    var VOL_ICONS = {
        off: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 640 512"><path fill="currentColor" d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3zM425 167l55 55 55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55 55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z"/></svg>',
        low: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 640 512"><path fill="currentColor" d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3zm105.5 145.2C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5z"/></svg>',
        mid: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 640 512"><path fill="currentColor" d="M473.1 107c43.2 35.2 70.9 88.9 70.9 149s-27.7 113.8-70.9 149c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C475.3 341.3 496 301.1 496 256s-20.7-85.3-53.2-111.8c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zm-60.5 74.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3z"/></svg>',
        high: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 640 512"><path fill="currentColor" d="M533.6 32.5C598.5 85.3 640 165.8 640 256s-41.5 170.8-106.4 223.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C557.5 398.2 592 331.2 592 256s-34.5-142.2-88.7-186.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM473.1 107c43.2 35.2 70.9 88.9 70.9 149s-27.7 113.8-70.9 149c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C475.3 341.3 496 301.1 496 256s-20.7-85.3-53.2-111.8c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zm-60.5 74.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3z"/></svg>'
    };
    function updateVolumeUI() {
        var vol = v.muted ? 0 : v.volume;
        if (volSlider) volSlider.value = Math.round(vol * 100);
        if (volIcon) {
            if (vol === 0) volIcon.innerHTML = VOL_ICONS.off;
            else if (vol < 0.25) volIcon.innerHTML = VOL_ICONS.low;
            else if (vol < 0.6) volIcon.innerHTML = VOL_ICONS.mid;
            else volIcon.innerHTML = VOL_ICONS.high;
        }
    }
    updateVolumeUI();
    updateVolumeUI();

    var hideTimer = null;
    var dragging = false;
    var shown = false;
    var settingsOpen = false;
    var _suppressShowUntil = 0;
    var _suppressTogglePlayUntil = 0;

    var subFontMap = { sans: 'var(--font)', serif: 'Georgia, serif', mono: 'monospace' };
    var subSizeMap = { small: '14px', medium: '18px', large: '23px', xlarge: '28px', xxlarge: '34px' };
    var subEdgeMap = {
        shadow: '0 2px 6px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.9)',
        outline: '-1px -1px 0 rgba(0,0,0,0.9), 1px -1px 0 rgba(0,0,0,0.9), -1px 1px 0 rgba(0,0,0,0.9), 1px 1px 0 rgba(0,0,0,0.9)',
        uniform: '0 0 4px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)',
        none: 'none'
    };
    var subPosMap = { top: '80%', high: '28%', mid: '10%', low: '4%', bottom: '1%' };

    function hexToRgba(hex, alpha) {
        var r = parseInt(hex.slice(1, 3), 16),
            g = parseInt(hex.slice(3, 5), 16),
            b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    }

    var savedSub = (function () {
        try { return JSON.parse(localStorage.getItem('subSettings') || '{}'); } catch (err) { return {}; }
    })();

    var subState = {
        activeTrack: -1,
        font: savedSub.font || 'sans',
        color: savedSub.color || '#ffffff',
        size: savedSub.size || 'medium',
        bgColor: savedSub.bgColor || '#000000',
        bgOpacity: savedSub.bgOpacity !== undefined ? savedSub.bgOpacity : '0.75',
        overallOpacity: savedSub.overallOpacity !== undefined ? savedSub.overallOpacity : '1',
        textShadow: savedSub.textShadow || 'shadow',
        pos: savedSub.pos || 'mid',
        edge: savedSub.edge || 'shadow',
        weight: savedSub.weight || '500',
        spacing: savedSub.spacing || 'normal',
        cues: [],
        cueTimer: null
    };

    var videoState = {
        brightness: 100,
        contrast: 100,
        saturate: 100,
        ratio: 'contain',
        ascii: false,
        asciiColor: true
    };

    var ASCII_CHARSET = ' `.-\':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@';
    var asciiRenderId = null;
    var asciiCanvas = null;
    var asciiCtx = null;
    var hiddenCanvas = null;
    var hiddenCtx = null;
    var offCanvas = null;
    var offCtx = null;

    var subPosMap = { top: '82%', high: '35%', mid: '12%', low: '6%', bottom: '2%' };
    var subWeightMap = { light: '300', normal: '500', bold: '700' };
    var subSpacingMap = { tight: '-0.5px', normal: '0px', wide: '1px', extra: '2px' };

    var savedSpeed = (function () {
        try {
            var r = parseFloat(localStorage.getItem('playbackSpeed'));
            return (!isNaN(r) && r > 0 && r <= 2) ? r : 1;
        } catch (err) { return 1; }
    })();

    var speedBoostEnabled = (function () {
        try { return localStorage.getItem('speedBoostEnabled') !== 'false'; } catch (ex) { return true; }
    })();

    function saveTimestamp(videoId, currentTime) {
        try {
            var timestamps = JSON.parse(localStorage.getItem('videoTimestamps') || '{}');
            timestamps[videoId] = currentTime;
            localStorage.setItem('videoTimestamps', JSON.stringify(timestamps));
        } catch (err) {
        }
    }

    function getTimestamp(videoId) {
        try {
            var timestamps = JSON.parse(localStorage.getItem('videoTimestamps') || '{}');
            return timestamps[videoId] || 0;
        } catch (err) {
            return 0;
        }
    }

    function clearTimestamp(videoId) {
        try {
            var timestamps = JSON.parse(localStorage.getItem('videoTimestamps') || '{}');
            delete timestamps[videoId];
            localStorage.setItem('videoTimestamps', JSON.stringify(timestamps));
        } catch (err) {
        }
    }

    function saveSubSettings() {
        try {
            localStorage.setItem('subSettings', JSON.stringify({
                font: subState.font,
                size: subState.size,
                color: subState.color,
                bgColor: subState.bgColor,
                bgOpacity: subState.bgOpacity,
                overallOpacity: subState.overallOpacity,
                textShadow: subState.textShadow,
                pos: subState.pos,
                edge: subState.edge,
                weight: subState.weight,
                spacing: subState.spacing
            }));
        } catch (err) { }
    }

    function applySubStyles() {
        subtitleDisplay.style.bottom = subPosMap[subState.pos];
        subtitleDisplay.style.opacity = subState.overallOpacity;
        subtitleText.style.fontFamily = subFontMap[subState.font];
        subtitleText.style.fontSize = subSizeMap[subState.size];
        subtitleText.style.color = subState.color;

        var textShadow = '';
        if (subState.textShadow === 'shadow') {
            textShadow = subEdgeMap.shadow;
        } else if (subState.textShadow === 'outline') {
            textShadow = subEdgeMap.outline;
        } else if (subState.textShadow === 'both') {
            textShadow = subEdgeMap.shadow + ', ' + subEdgeMap.outline;
        } else {
            textShadow = subEdgeMap.none;
        }
        subtitleText.style.textShadow = textShadow;

        subtitleText.style.fontWeight = subWeightMap[subState.weight] || '500';
        subtitleText.style.letterSpacing = subSpacingMap[subState.spacing] || '0px';

        var alpha = parseFloat(subState.bgOpacity);
        if (alpha > 0) {
            subtitleText.style.background = hexToRgba(subState.bgColor, alpha);
            subtitleText.style.padding = '4px 10px';
        } else {
            subtitleText.style.background = 'transparent';
            subtitleText.style.padding = '0';
        }
    }

    function applyVideoStyles() {
        v.style.filter = 'brightness(' + videoState.brightness + '%) contrast(' + videoState.contrast + '%) saturate(' + videoState.saturate + '%)';
        v.style.objectFit = videoState.ratio;
    }

    function ensureAsciiCanvases() {
        if (asciiCanvas && hiddenCanvas && offCanvas) return;
        var playerEl = document.getElementById('player');
        asciiCanvas = document.createElement('canvas');
        asciiCanvas.id = 'ascii-output-canvas';
        asciiCanvas.style.position = 'fixed';
        asciiCanvas.style.top = '0';
        asciiCanvas.style.left = '0';
        asciiCanvas.style.width = '100vw';
        asciiCanvas.style.height = '100vh';
        asciiCanvas.style.display = 'none';
        asciiCanvas.style.pointerEvents = 'none';
        asciiCanvas.style.zIndex = '17';
        asciiCanvas.style.background = 'black';
        document.body.appendChild(asciiCanvas);
        asciiCtx = asciiCanvas.getContext('2d');

        hiddenCanvas = document.createElement('canvas');
        hiddenCanvas.style.position = 'absolute';
        hiddenCanvas.style.left = '-9999px';
        hiddenCanvas.style.width = '1px';
        hiddenCanvas.style.height = '1px';
        hiddenCanvas.style.visibility = 'hidden';
        document.body.appendChild(hiddenCanvas);
        hiddenCtx = hiddenCanvas.getContext('2d');

        offCanvas = document.createElement('canvas');
        offCtx = offCanvas.getContext('2d');
    }

    function updateAsciiButtonUI() {
        var asciiBtn = document.getElementById('btn-toggle-ascii');
        var colorBtn = document.getElementById('btn-toggle-ascii-color');
        if (asciiBtn) {
            asciiBtn.classList.toggle('on', videoState.ascii);
        }
        if (colorBtn) {
            colorBtn.classList.toggle('on', videoState.asciiColor);
        }
    }

    function setAsciiCanvasVisibility(visible) {
        if (!asciiCanvas) return;
        asciiCanvas.style.display = visible ? 'block' : 'none';
    }

    function toggleAsciiMode(enabled) {
        videoState.ascii = enabled;
        updateVideoLabel();
        updateAsciiButtonUI();
        ensureAsciiCanvases();
        setAsciiCanvasVisibility(enabled);
        var pcw = document.getElementById('player-controls-wrapper');
        var tb = document.getElementById('title-bar');
        if (enabled) {
            if (pcw) { pcw.style.zIndex = '20'; pcw.style.position = 'fixed'; pcw.style.bottom = '0'; pcw.style.left = '0'; pcw.style.width = '100vw'; }
            if (tb) { tb.style.zIndex = '20'; tb.style.position = 'fixed'; tb.style.top = '0'; tb.style.left = '0'; tb.style.width = '100vw'; }
        } else {
            if (pcw) { pcw.style.zIndex = ''; pcw.style.position = ''; pcw.style.bottom = ''; pcw.style.left = ''; pcw.style.width = ''; }
            if (tb) { tb.style.zIndex = ''; tb.style.position = ''; tb.style.top = ''; tb.style.left = ''; tb.style.width = ''; }
        }
        var videoEl = document.getElementById('v') || v;
        if (enabled) {
            if (videoEl) { videoEl.style.opacity = '0'; videoEl.style.pointerEvents = 'none'; }
            startAsciiLoop();
        } else {
            if (videoEl) {
                videoEl.style.opacity = '1';
                videoEl.style.pointerEvents = '';
                videoEl.style.visibility = '';
            }
            stopAsciiLoop();
        }
    }

    function toggleAsciiColorMode(enabled) {
        videoState.asciiColor = enabled;
        updateAsciiButtonUI();
        if (videoState.ascii) {
            renderAsciiFrame();
        }
    }

    videoState.vr = false;
    videoState.vrSplit = 'single';

    var vrCanvas = null;
    var vrGl = null;
    var vrProgram = null;
    var vrTexture = null;
    var vrRenderId = null;
    var vrYaw = 0;
    var vrPitch = 0;
    var vrOrientationHandler = null;
    var vrPermissionBtn = null;

    function ensureVrCanvas() {
        if (vrCanvas) return true;
        vrCanvas = document.createElement('canvas');
        vrCanvas.id = 'vr-canvas';
        document.body.appendChild(vrCanvas);
        vrGl = vrCanvas.getContext('webgl') || vrCanvas.getContext('experimental-webgl');
        if (!vrGl) return false;
        return initVrGl();
    }

    function initVrGl() {
        var gl = vrGl;
        var vsSrc = 'attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.0,1.0);}';
        var fsSrc = 'precision mediump float;varying vec2 vUv;uniform sampler2D uTex;uniform float uYaw;uniform float uPitch;uniform float uEyeOffset;uniform float uCurve;' +
            'void main(){' +
            'vec2 p=(vUv-0.5)*2.0;' +
            'p.x+=uEyeOffset;' +
            'float r=length(p);' +
            'vec2 warped=p*(1.0+uCurve*r*r);' +
            'float lon=warped.x*1.2+uYaw;' +
            'float lat=warped.y*1.0+uPitch;' +
            'if(abs(lon)>1.0||abs(lat)>1.0){gl_FragColor=vec4(0.0,0.0,0.0,1.0);return;}' +
            'vec2 uv=vec2(lon*0.5+0.5,1.0-(lat*0.5+0.5));' +
            'gl_FragColor=texture2D(uTex,uv);' +
            '}';

        function compile(type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return s;
        }

        var vs = compile(gl.VERTEX_SHADER, vsSrc);
        var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        vrProgram = gl.createProgram();
        gl.attachShader(vrProgram, vs);
        gl.attachShader(vrProgram, fs);
        gl.linkProgram(vrProgram);
        if (!gl.getProgramParameter(vrProgram, gl.LINK_STATUS)) return false;

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        vrTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, vrTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        vrProgram._aPos = gl.getAttribLocation(vrProgram, 'aPos');
        vrProgram._uTex = gl.getUniformLocation(vrProgram, 'uTex');
        vrProgram._uYaw = gl.getUniformLocation(vrProgram, 'uYaw');
        vrProgram._uPitch = gl.getUniformLocation(vrProgram, 'uPitch');
        vrProgram._uEyeOffset = gl.getUniformLocation(vrProgram, 'uEyeOffset');
        vrProgram._uCurve = gl.getUniformLocation(vrProgram, 'uCurve');
        vrProgram._buf = buf;
        return true;
    }

    function resizeVrCanvas() {
        if (!vrCanvas) return;
        vrCanvas.width = window.innerWidth * (window.devicePixelRatio || 1);
        vrCanvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    }

    function renderVrFrame() {
        if (!videoState.vr || !vrGl || !vrProgram) return;
        var videoEl = document.getElementById('v') || v;
        if (!videoEl || videoEl.readyState < 2) {
            vrRenderId = requestAnimationFrame(renderVrFrame);
            return;
        }
        var gl = vrGl;
        gl.bindTexture(gl.TEXTURE_2D, vrTexture);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoEl);
        } catch (err) { }

        gl.useProgram(vrProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, vrProgram._buf);
        gl.enableVertexAttribArray(vrProgram._aPos);
        gl.vertexAttribPointer(vrProgram._aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(vrProgram._uTex, 0);
        gl.uniform1f(vrProgram._uYaw, vrYaw);
        gl.uniform1f(vrProgram._uPitch, vrPitch);
        gl.uniform1f(vrProgram._uCurve, 0.35);

        if (videoState.vrSplit === 'split') {
            var halfW = Math.floor(vrCanvas.width / 2);
            gl.viewport(0, 0, halfW, vrCanvas.height);
            gl.uniform1f(vrProgram._uEyeOffset, -0.06);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.viewport(halfW, 0, vrCanvas.width - halfW, vrCanvas.height);
            gl.uniform1f(vrProgram._uEyeOffset, 0.06);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } else {
            gl.viewport(0, 0, vrCanvas.width, vrCanvas.height);
            gl.uniform1f(vrProgram._uEyeOffset, 0.0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        vrRenderId = requestAnimationFrame(renderVrFrame);
    }

    function handleVrOrientation(e) {
        if (e.gamma === null || e.beta === null) return;
        var gamma = Math.max(-90, Math.min(90, e.gamma));
        var beta = Math.max(-90, Math.min(90, e.beta - 90));
        vrYaw = (gamma / 90) * 1.4;
        vrPitch = (beta / 90) * 1.1;
    }

    function startVrOrientation() {
        vrOrientationHandler = handleVrOrientation;
        window.addEventListener('deviceorientation', vrOrientationHandler, true);
    }

    function stopVrOrientation() {
        if (vrOrientationHandler) {
            window.removeEventListener('deviceorientation', vrOrientationHandler, true);
            vrOrientationHandler = null;
        }
        vrYaw = 0;
        vrPitch = 0;
    }

    function requestVrOrientationPermission(cb) {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(function (state) {
                cb(state === 'granted');
            }).catch(function () { cb(false); });
        } else {
            cb(true);
        }
    }

    function toggleVrMode(enabled) {
        if (!window.isMobile || !window.isMobile()) return;
        videoState.vr = enabled;
        var btnVr = document.getElementById('btn-toggle-vr');
        if (btnVr) btnVr.classList.toggle('on', enabled);
        var splitRow = document.getElementById('vr-split-row');
        if (splitRow) splitRow.style.display = enabled ? 'flex' : 'none';

        var videoEl = document.getElementById('v') || v;

        if (enabled) {
            if (!ensureVrCanvas()) {
                videoState.vr = false;
                if (btnVr) btnVr.classList.remove('on');
                return;
            }
            resizeVrCanvas();
            vrCanvas.style.display = 'block';
            if (videoEl) { videoEl.style.opacity = '0'; videoEl.style.pointerEvents = 'none'; }
            requestVrOrientationPermission(function (granted) {
                if (granted) startVrOrientation();
            });
            if (vrRenderId) cancelAnimationFrame(vrRenderId);
            renderVrFrame();
        } else {
            if (vrCanvas) vrCanvas.style.display = 'none';
            if (videoEl) { videoEl.style.opacity = '1'; videoEl.style.pointerEvents = ''; }
            if (vrRenderId) { cancelAnimationFrame(vrRenderId); vrRenderId = null; }
            stopVrOrientation();
        }
    }

    window.addEventListener('resize', function () {
        if (videoState.vr) resizeVrCanvas();
    });

    function startAsciiLoop() {
        if (asciiRenderId) return;
        asciiRenderId = requestAnimationFrame(renderAsciiFrame);
    }

    function stopAsciiLoop() {
        if (asciiRenderId) {
            cancelAnimationFrame(asciiRenderId);
            asciiRenderId = null;
        }
    }

    function renderAsciiError() {
        if (!asciiCtx) return;
        var dpr = window.devicePixelRatio || 1;
        var canvasWidth = window.innerWidth * dpr;
        var canvasHeight = window.innerHeight * dpr;
        asciiCanvas.width = canvasWidth;
        asciiCanvas.height = canvasHeight;
        asciiCanvas.style.width = '100vw';
        asciiCanvas.style.height = '100vh';
        asciiCtx.setTransform(1, 0, 0, 1, 0, 0);
        asciiCtx.fillStyle = '#000';
        asciiCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        asciiCtx.font = '18px sans-serif';
        asciiCtx.fillStyle = '#fff';
        asciiCtx.fillText('ASCII Render unavailable. CORS blocks frame read.', 20, 40);
        asciiCtx.fillText('Switch back to normal playback to continue.', 20, 72);
    }

    function renderAsciiFrame() {
        asciiRenderId = null;
        if (!videoState.ascii) {
            var _ve = document.getElementById('v') || v;
            if (_ve) _ve.style.visibility = '';
            return;
        }
        var videoEl = document.getElementById('v') || v;
        if (!videoEl || !asciiCtx || !hiddenCtx) {
            asciiRenderId = requestAnimationFrame(renderAsciiFrame);
            return;
        }

        videoEl.style.visibility = 'hidden';
        var sourceWidth = videoEl.videoWidth || videoEl.clientWidth || window.innerWidth;
        var sourceHeight = videoEl.videoHeight || videoEl.clientHeight || window.innerHeight;
        if (sourceWidth === 0 || sourceHeight === 0) {
            asciiRenderId = requestAnimationFrame(renderAsciiFrame);
            return;
        }

        hiddenCanvas.width = sourceWidth;
        hiddenCanvas.height = sourceHeight;
        try {
            hiddenCtx.drawImage(videoEl, 0, 0, sourceWidth, sourceHeight);
        } catch (err) {
            renderAsciiError();
            return;
        }

        var dpr = window.devicePixelRatio || 1;
        var canvasWidth = window.innerWidth * dpr;
        var canvasHeight = window.innerHeight * dpr;
        asciiCanvas.width = canvasWidth;
        asciiCanvas.height = canvasHeight;
        asciiCanvas.style.width = '100vw';
        asciiCanvas.style.height = '100vh';
        asciiCtx.setTransform(1, 0, 0, 1, 0, 0);
        asciiCtx.font = (7 * dpr) + 'px "Courier New", Courier, monospace';

        var measuredWidth = asciiCtx.measureText('M').width;
        var metrics = asciiCtx.measureText('M');
        var charWidth = Math.ceil(measuredWidth);
        var charHeight = Math.ceil((metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || charWidth * 2);
        var cols = Math.floor(canvasWidth / charWidth);
        var rows = Math.floor(canvasHeight / charHeight);
        offCanvas.width = cols;
        offCanvas.height = rows;
        offCtx.drawImage(hiddenCanvas, 0, 0, cols, rows);

        var frameData;
        try {
            frameData = offCtx.getImageData(0, 0, cols, rows).data;
        } catch (err) {
            renderAsciiError();
            return;
        }

        asciiCtx.fillStyle = '#000';
        asciiCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        asciiCtx.textBaseline = 'top';
        asciiCtx.textAlign = 'left';
        if (!window._asciiDebugLogged) {
            window._asciiDebugLogged = true;
            var metrics = asciiCtx.measureText('M');
        }

        var offsetX = Math.max(0, Math.floor((canvasWidth - cols * charWidth) / 2));
        var offsetY = Math.max(0, Math.floor((canvasHeight - rows * charHeight) / 2));
        var charsetLength = ASCII_CHARSET.length - 1;

        for (var y = 0; y < rows; y++) {
            for (var x = 0; x < cols; x++) {
                var idx = (y * cols + x) * 4;
                var r = frameData[idx];
                var g = frameData[idx + 1];
                var b = frameData[idx + 2];
                var lum = 0.299 * r + 0.587 * g + 0.114 * b;
                var charIndex = Math.min(charsetLength, Math.max(0, Math.floor((lum / 255) * charsetLength)));
                var asciiChar = ASCII_CHARSET.charAt(charIndex);
                if (asciiChar === ' ') continue;

                if (videoState.asciiColor) {
                    asciiCtx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
                } else {
                    var gray = Math.round(lum);
                    asciiCtx.fillStyle = 'rgb(' + gray + ',' + gray + ',' + gray + ')';
                }
                asciiCtx.fillText(asciiChar, offsetX + x * charWidth, offsetY + y * charHeight);
            }
        }

        asciiRenderId = requestAnimationFrame(renderAsciiFrame);
    }

    if (subFontSelect) subFontSelect.value = subState.font;
    if (subSizeSelect) subSizeSelect.value = subState.size;
    if (subColorInput) subColorInput.value = subState.color;
    if (subBgColorInput) subBgColorInput.value = subState.bgColor;
    if (subBgOpacitySelect) subBgOpacitySelect.value = subState.bgOpacity;
    if (subPosSelect) subPosSelect.value = subState.pos;
    if (subEdgeSelect) subEdgeSelect.value = subState.edge;

    applySubStyles();
    updateAsciiButtonUI();

    function updateListActive(containerId, clickedEl, labelId, labelText) {
        var container = document.getElementById(containerId);
        container.querySelectorAll('.settings-list-item').forEach(function (el) {
            el.classList.remove('active');
            var icon = el.querySelector('i');
            if (icon) icon.className = 'fa-regular fa-circle';
        });
        clickedEl.classList.add('active');
        var clickedIcon = clickedEl.querySelector('i');
        if (clickedIcon) clickedIcon.className = 'fa-regular fa-circle-dot';
        var labelEl = document.getElementById(labelId);
        if (labelEl) labelEl.textContent = labelText;
    }

    var _showedAt = 0;

    window.showUI = function showUI(pin) {
        if (window.__sourceDiscoveryUiHidden) {
            return;
        }
        if (Date.now() < _suppressShowUntil && pin !== true) return;
        var pl = document.getElementById('player');
        if (!pl) return;
        controlsWrapper.classList.add('on');
        titleBar.classList.add('on');
        pl.classList.add('ui-on');
        shown = true;
        _showedAt = Date.now();
        clearTimeout(hideTimer);
        if (!pin && !v.paused && !settingsOpen) {
            hideTimer = setTimeout(hideUI, 3200);
        }
    }

    window.hideUI = function hideUI() {
        if (settingsOpen) return;
        if (Date.now() - _showedAt < 320) return;
        var pl = document.getElementById('player');
        if (!pl) return;
        controlsWrapper.classList.remove('on');
        titleBar.classList.remove('on');
        pl.classList.remove('ui-on');
        shown = false;
    }

    v.addEventListener('play', function () {
        ci.className = 'fa-solid fa-pause';
        centerFlash.classList.remove('paused');
    });

    v.addEventListener('pause', function () {
        ci.className = 'fa-solid fa-play';
        centerFlash.classList.add('paused');
    });

    function flashCenter() {
        ci.classList.remove('pop');
        void ci.offsetWidth;
        ci.classList.add('pop');
    }

    var _progRaf = null;
    function setProg() {
        if (!v.duration || dragging) return;
        if (_progRaf) return;
        _progRaf = requestAnimationFrame(function () {
            _progRaf = null;
            if (!v.duration || dragging) return;
            var pct = v.currentTime / v.duration * 100;
            prog.style.width = pct + '%';
            thumb.style.left = 'calc(' + pct + '% - ' + (pct / 100 * 0) + 'px)';
            tCur.textContent = window.fmt(v.currentTime);
            tDur.textContent = window.fmt(v.duration);
            if (tdCur) tdCur.textContent = window.fmt(v.currentTime);
            if (tdDur) tdDur.textContent = window.fmt(v.duration);
            if (v.buffered.length) {
                var bufEnd = 0;
                for (var bi = 0; bi < v.buffered.length; bi++) {
                    if (v.buffered.start(bi) <= v.currentTime + 1) {
                        bufEnd = Math.max(bufEnd, v.buffered.end(bi));
                    }
                }
                bufEl.style.width = (bufEnd / v.duration * 100) + '%';
            }
        });
    }

    var _seekRaf = null;
    var _seekPct = 0;
    function seekX(x) {
        var r = wrap.getBoundingClientRect();
        _seekPct = Math.max(0, Math.min(1, (x - r.left) / r.width));
        var pct = _seekPct;
        prog.style.width = (pct * 100) + '%';
        thumb.style.left = (pct * 100) + '%';
        tCur.textContent = window.fmt(pct * (v.duration || 0));
        if (!dragging) {
            v.currentTime = pct * (v.duration || 0);
        }
    }

    function commitSeek(x) {
        var r = wrap.getBoundingClientRect();
        var pct = (x !== undefined) ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : _seekPct;
        v.currentTime = pct * (v.duration || 0);
        if (typeof window._checkAndShowNextEpBtn === 'function') window._checkAndShowNextEpBtn();
    }

    var tooltipTime = document.getElementById('tooltip-time');

    var lastTooltipPct = -1;

    var skipAccL = 0, skipAccR = 0;
    var skipResetTimers = { left: null, right: null };

    function hoverTooltip(x) {
        if (!v.duration) return;
        var r = wrap.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (x - r.left) / r.width));
        var t = pct * v.duration;
        var thumbHalf = 8;
        var tipLeft = Math.max(thumbHalf, Math.min(r.width - thumbHalf, pct * r.width));
        tooltip.style.left = tipLeft + 'px';
        tooltipTime.textContent = window.fmt(t);
        tooltip.classList.add('show');
        lastTooltipPct = pct;
    }

    window.doSkip = function doSkip(dir, taps) {
        var secs = taps * 10;
        var delta = dir === 'left' ? -secs : secs;
        v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
        if (typeof window._checkAndShowNextEpBtn === 'function') window._checkAndShowNextEpBtn();

        var el = dir === 'left' ? skipL : skipR;
        var lbl = dir === 'left' ? skipLLbl : skipRLbl;

        if (dir === 'left') {
            skipAccL += secs;
            lbl.textContent = '-' + skipAccL + 's';
            clearTimeout(skipResetTimers.left);
            skipResetTimers.left = setTimeout(function () {
                skipAccL = 0;
                el.classList.remove('show');
                el.classList.add('hide');
                setTimeout(function () { el.classList.remove('hide'); lbl.textContent = '-10s'; }, 420);
            }, 900);
        } else {
            skipAccR += secs;
            lbl.textContent = '+' + skipAccR + 's';
            clearTimeout(skipResetTimers.right);
            skipResetTimers.right = setTimeout(function () {
                skipAccR = 0;
                el.classList.remove('show');
                el.classList.add('hide');
                setTimeout(function () { el.classList.remove('hide'); lbl.textContent = '+10s'; }, 420);
            }, 900);
        }

        el.classList.remove('hide');
        void el.offsetWidth;
        el.classList.add('show');
        window.haptic();
    }

    function onReady() {
        v.classList.add('ready');
        var _alignTimer = setInterval(function () {
            if (v.buffered.length && v.currentTime < v.buffered.start(0) - 0.5) {
                v.currentTime = v.buffered.start(0);
                clearInterval(_alignTimer);
            } else if (v.currentTime > 0 || (v.buffered.length && v.currentTime >= v.buffered.start(0))) {
                clearInterval(_alignTimer);
            }
        }, 100);
        v.playbackRate = savedSpeed;
        var onRateGuard = function () {
            if (Math.abs(v.playbackRate - savedSpeed) > 0.01) {
                v.playbackRate = savedSpeed;
            }
        };
        v.addEventListener('ratechange', onRateGuard);
        setTimeout(function () { v.removeEventListener('ratechange', onRateGuard); }, 3000);
        tDur.textContent = window.fmt(v.duration);
        var loaderBottomGlow = document.querySelector('.loader-bottom-glow');
        if (loaderBottomGlow) loaderBottomGlow.classList.add('video-playing');
        setTimeout(function () { showUI(true); }, 180);
        scheduleRetry();
        attemptAutoplay();
        restoreVolume();

        if (volIcon) volIcon.innerHTML = VOL_ICONS.high;
        if (volSlider) volSlider.value = 100;
        updateVolumeUI();

        if (volSlider) {
            volSlider.addEventListener('input', function () {
                v.volume = this.value / 100;
                v.muted = this.value == 0;
                updateVolumeUI();
            });
        }

        var btnVolume = document.getElementById('btn-volume');
        if (btnVolume) {
            btnVolume.addEventListener('click', function (e) {
                e.stopPropagation();
                v.muted = !v.muted;
                updateVolumeUI();
            });
        }

        v.addEventListener('volumechange', updateVolumeUI);
    }

    var _autoplayUnlocked = false;
    var _pendingUnmute = false;

    function attemptAutoplay() {
        var p = v.play();
        if (p !== undefined) {
            p.then(function () {
                if (v.muted) {
                    _pendingUnmute = true;
                    showUnmuteHint();
                } else {
                    _autoplayUnlocked = true;
                }
            }).catch(function () {
                v.muted = true;
                v.play().then(function () {
                    _pendingUnmute = true;
                    showUnmuteHint();
                }).catch(function () {
                    showUnmuteHint();
                });
            });
        } else {
            v.muted = true;
            showUnmuteHint();
        }
    }

    function showUnmuteHint() {
        var hint = document.getElementById('unmute-hint');
        var _unmuteDone = false;

        hint.style.opacity = '1';
        hint.style.pointerEvents = 'auto';

        function doUnmute() {
            if (_unmuteDone) return;
            _unmuteDone = true;
            v.muted = false;
            v.volume = 1;
            _autoplayUnlocked = true;
            _pendingUnmute = false;
            hint.style.opacity = '0';
            setTimeout(function () { hint.style.display = 'none'; }, 300);
            hint.removeEventListener('touchend', onHintTouch);
            hint.removeEventListener('click', onHintClick);
            document.removeEventListener('touchend', onDocTouch, true);
            document.removeEventListener('click', onDocClick, true);
            window.haptic();
        }

        function onHintTouch(ev) {
            ev.stopPropagation();
            ev.preventDefault();
            doUnmute();
        }

        function onHintClick(ev) {
            ev.stopPropagation();
            doUnmute();
        }

        var _docListenerReady = false;
        setTimeout(function () { _docListenerReady = true; }, 600);

        function onDocTouch(ev) {
            if (!_docListenerReady) return;
            if (ev.target.id === '__hx') return;
            doUnmute();
        }

        function onDocClick(ev) {
            if (!_docListenerReady) return;
            if (ev.target.id === '__hx') return;
            doUnmute();
        }

        hint.addEventListener('touchend', onHintTouch, { passive: false });
        hint.addEventListener('click', onHintClick);
        document.addEventListener('touchend', onDocTouch, true);
        document.addEventListener('click', onDocClick, true);
    }

    function unlockOnInteraction() {
        if (_autoplayUnlocked) return;
        function tryPlay() {
            if (v.paused) {
                v.muted = true;
                v.play().then(function () { _pendingUnmute = true; showUnmuteHint(); }).catch(function () { });
            }
            document.removeEventListener('touchstart', tryPlay);
            document.removeEventListener('mousedown', tryPlay);
        }
        document.addEventListener('touchstart', tryPlay, { once: true, passive: true });
        document.addEventListener('mousedown', tryPlay, { once: true });
    }

    window.addEventListener('orientationchange', function () {
        setTimeout(function () {
            shown = false;
            showUI(true);
            var pcw = document.getElementById('player-controls-wrapper');
            if (pcw) {
                pcw.style.pointerEvents = '';
                pcw.style.opacity = '';
            }
        }, 350);
    });

    unlockOnInteraction();

    function restoreVolume() {
        try {
            var vol = parseFloat(localStorage.getItem('playerVolume'));
            if (!isNaN(vol) && vol >= 0 && vol <= 1) v.volume = vol;
        } catch (ex) { }
    }

    v.addEventListener('volumechange', function () {
        if (!v.muted) {
            try { localStorage.setItem('playerVolume', v.volume); } catch (ex) { }
        }
    });

    var retryCount = 0;
    var maxRetries = 6;
    var retryTimer = null;
    var durationPollTimer = null;

    function scheduleRetry() {
        if (retryCount >= maxRetries) return;
        retryTimer = setTimeout(function () {
            if (!isNaN(v.duration) && v.duration > 0) return;
            if (v.readyState >= 2) return;
            retryCount++;
            showBuffering();
            var isMp4 = isDirectMediaUrl(src);
            if (!isMp4 && Hls.isSupported()) {
                hls.stopLoad();
                hls.startLoad();
            }
            scheduleRetry();
        }, 800);
    }

    function startDurationPoll() {
        clearInterval(durationPollTimer);
        var pollCount = 0;
        durationPollTimer = setInterval(function () {
            pollCount++;
            if (!isNaN(v.duration) && v.duration > 0) {
                clearInterval(durationPollTimer);
                tDur.textContent = window.fmt(v.duration);
                restoreTimestamp();
                return;
            }
            if (pollCount >= 40) {
                clearInterval(durationPollTimer);
            }
        }, 250);
    }

    var bufSpinner = document.getElementById('buffering-spinner');
    var bufferingTimeout = null;

    function showBuffering() {
        clearTimeout(bufferingTimeout);
        bufferingTimeout = setTimeout(function () {
            if (v.paused || v.readyState >= 3) return;
            bufSpinner.classList.add('active');
        }, 500);
    }

    function showBufferingImmediate() {
        clearTimeout(bufferingTimeout);
        bufSpinner.style.display = 'flex';
        bufSpinner.classList.add('active');
    }

    function hideBuffering() {
        clearTimeout(bufferingTimeout);
        bufSpinner.classList.remove('active');
        bufSpinner.style.display = '';
    }

    v.addEventListener('waiting', showBuffering);
    v.addEventListener('stalled', showBuffering);
    v.addEventListener('playing', hideBuffering);
    v.addEventListener('canplay', hideBuffering);

    v.addEventListener('playing', function () {
        var errScreen = document.getElementById('error-screen');
        if (errScreen) errScreen.classList.remove('show');
    });

    v.addEventListener('canplay', function () {
        var errScreen = document.getElementById('error-screen');
        if (errScreen && v.duration > 0 && !isNaN(v.duration)) {
            errScreen.classList.remove('show');
        }
    });

    var _videoErrBlocked = false;
    var _activePlaybackAttempt = false;
    var _activePlaybackErrorShown = false;

    function showPlaybackError(detail) {
        console.error('Error', {
            message: detail,
            currentUrl: window._activeMediaUrl || v.src,
            readyState: v.readyState,
            networkState: v.networkState,
            error: v.error
        });

        if (typeof currentSourceIndex === 'number' && Array.isArray(window.sources) && currentSourceIndex < window.sources.length - 1) {
            currentSourceIndex++;
            var nextSource = window.sources[currentSourceIndex];
            if (typeof showSrcDetail === 'function') {
                showSrcDetail(nextSource, currentSourceIndex);
                return;
            }
        }

        if (_activePlaybackErrorShown) return;
        _activePlaybackErrorShown = true;

        var errText = document.querySelector('.err-text');
        var errSub = document.querySelector('.err-sub');
        if (errText) errText.textContent = 'Playback failed';
        if (!errSub && errText) {
            errText.insertAdjacentHTML('afterend', '<div class="err-sub"></div>');
            errSub = document.querySelector('.err-sub');
        }
        if (errSub) {
            var displayMsg = detail || 'The video source could not be played. This may be due to a temporary network issue or an unsupported format.';
            errSub.textContent = displayMsg + ' (Source: ' + (window._activeSourceLabel || 'Unknown') + ')';
        }
        var errScreen = document.getElementById('error-screen');
        if (errScreen) errScreen.classList.add('show');
        hideBuffering();
    }

    v.addEventListener('error', function () {
        if (_videoErrBlocked || !_activePlaybackAttempt) return;
        var detail = window.__lastSourceError && window.__lastSourceError.details && window.__lastSourceError.details.error
            ? window.__lastSourceError.details.error
            : 'The video source could not be loaded. It may be unavailable or the URL may be incorrect.';
        showPlaybackError(detail);
    });

    var isAutoQuality = true;
    var selectedQualityLabel = null;

    function buildQualityOpts() {
        qualityOptsEl.innerHTML = '';
        var items = [];
        if (window.hls && window.hls.levels && window.hls.levels.length > 0) {
            window.hls.levels.forEach(function (lvl, idx) {
                var h = lvl.height || (lvl.attrs && lvl.attrs.RESOLUTION && lvl.attrs.RESOLUTION.height) || 0;
                var label = h ? h + 'p' : (lvl.name || 'Quality ' + (idx + 1));
                items.push({
                    label: label,
                    value: idx,
                    type: 'hls',
                    height: h,
                    bitrate: lvl.bitrate || 0
                });
            });
        } else if (Array.isArray(window.sources)) {
            window.sources.forEach(function (s) {
                if (s.quality || (s.label && /\d+p/i.test(s.label))) {
                    items.push({
                        label: s.quality || s.label,
                        value: s.url,
                        type: 'direct',
                        height: parseInt(s.quality || s.label) || 0
                    });
                }
            });
        }

        items.sort(function (a, b) {
            if (b.height !== a.height) return b.height - a.height;
            return (b.bitrate || 0) - (a.bitrate || 0);
        });

        var seen = {};
        items.forEach(function (item) {
            if (seen[item.label]) return;
            seen[item.label] = true;

            var row = document.createElement('div');
            row.className = 'quality-row';
            row.innerHTML = '<span class="quality-row-label">' + item.label + '</span><i class="fa-solid fa-check quality-row-check"></i>';

            row.addEventListener('click', function (e) {
                e.stopPropagation();
                isAutoQuality = false;
                selectedQualityLabel = item.label;
                if (item.type === 'hls') {
                    window.hls.currentLevel = item.value;
                    window.hls.loadLevel = item.value;
                } else if (item.type === 'dash') {
                    window.dashPlayer.setQualityFor('video', item.value, true);
                } else {
                    var curr = v.currentTime;
                    switchSource(item.value, true);
                    v.currentTime = curr;
                }
                updateQualityLabel();
                updateQualityRowUI();
                window.haptic(6);
            });
            qualityOptsEl.appendChild(row);
        });

        var divider = document.createElement('div');
        divider.className = 'quality-divider';
        qualityOptsEl.appendChild(divider);

        var autoRow = document.createElement('div');
        autoRow.className = 'quality-auto-row';
        autoRow.innerHTML = '<span class="quality-auto-label">Automatic quality</span><div class="settings-toggle' + (isAutoQuality ? ' on' : '') + '" id="quality-auto-toggle"><div class="settings-toggle-knob"></div></div>';
        qualityOptsEl.appendChild(autoRow);

        autoRow.querySelector('#quality-auto-toggle').addEventListener('click', function (e) {
            e.stopPropagation();
            isAutoQuality = true;
            selectedQualityLabel = null;
            if (window.hls) {
                window.hls.currentLevel = -1;
                window.hls.loadLevel = -1;
            }
            if (window.dashPlayer) {
                window.dashPlayer.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
            }
            updateQualityLabel();
            updateQualityRowUI();
            window.haptic(6);
        });
        updateQualityRowUI();
    }

    function updateQualityRowUI() {
        var rows = qualityOptsEl.querySelectorAll('.quality-row');
        rows.forEach(function (row) {
            var label = row.querySelector('.quality-row-label').textContent;
            var check = row.querySelector('.quality-row-check');
            var isActive = !isAutoQuality && selectedQualityLabel === label;
            row.classList.toggle('quality-row-active', isActive);
            if (check) {
                check.style.display = isActive ? 'block' : 'none';
            }
        });

        var toggle = document.getElementById('quality-auto-toggle');
        if (toggle) toggle.classList.toggle('on', isAutoQuality);
    }

    function updateQualityLabel() {
        var lbl = document.getElementById('lbl-quality');
        if (!lbl) return;

        if (!isAutoQuality && selectedQualityLabel) {
            lbl.textContent = selectedQualityLabel;
            return;
        }

        if (window.hls && window.hls.levels && window.hls.levels.length > 0) {
            var activeIdx = window.hls.currentLevel === -1 ? window.hls.loadLevel : window.hls.currentLevel;
            if (activeIdx === -1) activeIdx = window.hls.nextLoadLevel;
            var currentLevel = window.hls.levels[activeIdx];
            if (currentLevel) {
                var h = currentLevel.height || (currentLevel.attrs && currentLevel.attrs.RESOLUTION && currentLevel.attrs.RESOLUTION.height);
                if (h) {
                    var displayH = h >= 2000 ? '4K' : h + 'p';
                    lbl.textContent = 'Auto (' + displayH + ')';
                    return;
                }
            }
        }
        lbl.textContent = 'Auto';
    }

    function isDirectMediaUrl(url) {
        if (!url) return false;
        var str = String(url);
        if (/\.m3u8/i.test(str)) return false;
        if (/\.(mp4|m4v|webm|ogg|mov|mkv|avi)(?:\?|#|$)/i.test(str)) return true;
        if (/[?&](fn|file|fs|fx)=1/i.test(str)) return true;
        if (/(?:^|[/?&])type=mp4(?:$|[?&])/i.test(str)) return true;
        if (/\/videos\//i.test(str)) return true;
        try {
            var parsed = new URL(str, window.location.href);
            var search = parsed.searchParams;
            var isLocalProxy = parsed.pathname === '/api' || parsed.pathname.endsWith('/api') || parsed.pathname.includes('/api/proxy');
            if (isLocalProxy && search.has('url')) return true;
        } catch (ex) { }
        return false;
    }

    function isDashUrl(url) {
        if (!url) return false;
        return /\.mpd(?:\?|#|$)/i.test(String(url));
    }

    function ensureDashJs(cb) {
        if (window.dashjs) { cb(); return; }
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.all.min.js';
        script.onload = cb;
        script.onerror = function () { showPlaybackError('Failed to load DASH player'); };
        document.head.appendChild(script);
    }

    function playDirectSource(url, shouldResumePlayback) {
        if (!url) return;
        window._activeMediaUrl = url;
        showBufferingImmediate();
        switchSource(url, shouldResumePlayback !== false);
    }

    playDirectSource(src, true);

    if (savedSpeed !== 1) {
        speedOpts.forEach(function (btn) {
            if (parseFloat(btn.dataset.speed) === savedSpeed) {
                updateListActive('speed-opts', btn, 'lbl-speed', btn.textContent.trim());
            }
        });
    }

    var PROXY = window.baseURL + '/api/proxy?url=';
    var vylaEndpoint = (function () {
        var base = window.baseURL || '';
        var p = new URLSearchParams({ tmdbId: id });
        if (s) {
            p.set('season', s);
            p.set('episode', e || '1');
        }
        return base + '/api/subtitles?' + p.toString();
    })();

    document.getElementById('lbl-subtitle').textContent = 'Off';

    var inlineEl = document.getElementById('sub-entries-inline');
    if (inlineEl) inlineEl.innerHTML = '<div class="sub-skeleton">' +
        '<div class="sub-skel-item"></div>' +
        '<div class="sub-skel-item"></div>' +
        '<div class="sub-skel-item"></div>' +
        '</div>';

    function _toSec(str) {
        str = str.trim().split(' ')[0].replace(',', '.');
        var p = str.split(':');
        if (p.length === 2) return +p[0] * 60 + +p[1];
        return +p[0] * 3600 + +p[1] * 60 + +p[2];
    }

    function _stripTags(s) {
        return s.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    }

    function parseVTT(text) {
        var cues = [];
        text.trim().split(/\n\s*\n/).forEach(function (block) {
            var lines = block.trim().split('\n');
            var ti = -1;
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) { ti = i; break; }
            }
            if (ti < 0) return;
            var parts = lines[ti].split('-->');
            var txt = lines.slice(ti + 1).map(_stripTags).join('\n').trim();
            if (txt) cues.push({ start: _toSec(parts[0]), end: _toSec(parts[1]), text: txt });
        });
        return cues;
    }

    function parseSRT(text) {
        var cues = [];
        text.trim().split(/\n\s*\n/).forEach(function (block) {
            var lines = block.trim().split('\n');
            var ti = -1;
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].includes('-->')) { ti = i; break; }
            }
            if (ti < 0) return;
            var parts = lines[ti].split('-->');
            var txt = lines.slice(ti + 1).map(_stripTags).join('\n').trim();
            if (txt) cues.push({ start: _toSec(parts[0]), end: _toSec(parts[1]), text: txt });
        });
        return cues;
    }

    function parseCues(text) {
        var t = text.trim();
        var cues = parseVTT(t);
        if (!cues.length) cues = parseSRT(t);
        return cues;
    }

    var subStorageKey = 'subs_' + (s ? id + '_s' + s + '_e' + (e || '1') : id);

    function getLocalSubs() {
        try {
            return JSON.parse(localStorage.getItem(subStorageKey) || '[]');
        } catch (err) {
            return [];
        }
    }

    function saveLocalSub(name, cues) {
        var list = getLocalSubs();
        list.push({ id: Date.now().toString(), name: name, cues: cues });
        try {
            localStorage.setItem(subStorageKey, JSON.stringify(list));
        } catch (err) { }
        renderCustomSubList();
    }

    function removeLocalSub(subId) {
        var list = getLocalSubs().filter(function (x) { return x.id !== subId; });
        try {
            localStorage.setItem(subStorageKey, JSON.stringify(list));
        } catch (err) { }
        if (subState.customSubId === subId) {
            subState.activeTrack = -1;
            subState.cues = [];
            subState.customSubId = null;
            subtitleText.textContent = '';
            _lastCueText = '';
            document.getElementById('lbl-subtitle').textContent = 'Off';
            var mainToggle = document.getElementById('subtitle-toggle');
            if (mainToggle) mainToggle.classList.remove('on');
            var offCheck = document.getElementById('sub-off-check');
            if (offCheck) offCheck.style.display = 'block';
        }
        renderCustomSubList();
    }

    window.subtitlesPromise = null;
    if (window.store && window.store.id) {
        var base = window.baseURL || '';
        var p = new URLSearchParams({ tmdbId: window.store.id });
        if (window.store.s) {
            p.set('season', window.store.s);
            p.set('episode', window.store.e || '1');
        }
        window.subtitlesPromise = fetch(base + '/api/subtitles?' + p.toString())
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .catch(function () {
                return { subtitles: [] };
            });
    }

    function renderCustomSubList() {
        var section = document.getElementById('sub-uploaded-section');
        var container = document.getElementById('sub-uploaded-list');
        if (!container || !section) return;
        var list = getLocalSubs();
        if (!list.length) {
            container.innerHTML = '';
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        container.innerHTML = '';
        list.forEach(function (item) {
            var row = document.createElement('div');
            var isActive = subState.customSubId === item.id;
            row.className = 'sub-uploaded-item' + (isActive ? ' active' : '');

            var ext = (item.name.split('.').pop() || 'SUB').toUpperCase();

            row.innerHTML =
                '<div class="sub-uploaded-left">' +
                '<div class="sub-uploaded-icon"><i class="fa-solid fa-closed-captioning"></i></div>' +
                '<div class="sub-uploaded-details">' +
                '<span class="sub-uploaded-name">' + item.name + '</span>' +
                '<span class="sub-uploaded-tag">' + ext + ' \u00b7 Uploaded</span>' +
                '</div>' +
                '</div>' +
                '<div class="sub-uploaded-right">' +
                (isActive ? '<div class="sub-uploaded-check"><i class="fa-solid fa-check"></i></div>' : '') +
                '<button class="sub-uploaded-del" title="Delete"><i class="fa-solid fa-trash-can"></i></button>' +
                '</div>';

            row.querySelector('.sub-uploaded-del').addEventListener('click', function (e) {
                e.stopPropagation();
                window.haptic(6);
                removeLocalSub(item.id);
            });

            row.addEventListener('click', function () {
                window.haptic(6);
                subState.activeTrack = -2;
                subState.customSubId = item.id;
                subState.cues = item.cues;
                _lastCueText = null;
                document.getElementById('lbl-subtitle').textContent = item.name;
                var offCheck = document.getElementById('sub-off-check');
                if (offCheck) offCheck.style.display = 'none';
                var mainToggle = document.getElementById('subtitle-toggle');
                if (mainToggle) mainToggle.classList.add('on');
                document.querySelectorAll('.sub-special-item, .sub-lang-item').forEach(function (x) {
                    x.classList.remove('active-sub-item');
                });
                renderCustomSubList();
                closeSettings();
            });

            container.appendChild(row);
        });
    }

    var uploadRow = document.getElementById('sub-upload-row');
    var fileInput = document.getElementById('sub-file-input');

    if (uploadRow && fileInput) {
        uploadRow.addEventListener('click', function (e) {
            e.stopPropagation();
            fileInput.click();
        });

        uploadRow.addEventListener('dragover', function (e) {
            e.preventDefault();
        });

        uploadRow.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                var cues = parseCues(ev.target.result);
                if (cues && cues.length) {
                    saveLocalSub(file.name, cues);
                    var list = getLocalSubs();
                    var latest = list[list.length - 1];
                    if (latest) {
                        subState.activeTrack = -2;
                        subState.customSubId = latest.id;
                        subState.cues = cues;
                        _lastCueText = null;
                        document.getElementById('lbl-subtitle').textContent = file.name;
                        var offCheck = document.getElementById('sub-off-check');
                        if (offCheck) offCheck.style.display = 'none';
                        var mainToggle = document.getElementById('subtitle-toggle');
                        if (mainToggle) mainToggle.classList.add('on');
                        renderCustomSubList();
                        closeSettings();
                    }
                }
            };
            reader.readAsText(file);
        });

        fileInput.addEventListener('change', function () {
            var file = this.files && this.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                var text = ev.target.result;
                var cues = parseCues(text);
                if (cues && cues.length) {
                    saveLocalSub(file.name, cues);
                    var list = getLocalSubs();
                    var latest = list[list.length - 1];
                    if (latest) {
                        subState.activeTrack = -2;
                        subState.customSubId = latest.id;
                        subState.cues = cues;
                        _lastCueText = null;
                        document.getElementById('lbl-subtitle').textContent = file.name;
                        var offCheck = document.getElementById('sub-off-check');
                        if (offCheck) offCheck.style.display = 'none';
                        var mainToggle = document.getElementById('subtitle-toggle');
                        if (mainToggle) mainToggle.classList.add('on');
                        renderCustomSubList();
                        closeSettings();
                    }
                }
            };
            reader.readAsText(file);
            this.value = '';
        });
    }

    var offRow = document.getElementById('sub-off-row');
    if (offRow) {
        offRow.addEventListener('click', function () {
            subState.activeTrack = -1;
            subState.customSubId = null;
            subState.cues = [];
            subtitleText.textContent = '';
            _lastCueText = '';
            document.getElementById('lbl-subtitle').textContent = 'Off';
            var offCheck = document.getElementById('sub-off-check');
            if (offCheck) offCheck.style.display = 'block';
            var mainToggle = document.getElementById('subtitle-toggle');
            if (mainToggle) mainToggle.classList.remove('on');
            renderCustomSubList();
        });
    }

    renderCustomSubList();

    function findCue(cues, t) {
        var lo = 0, hi = cues.length - 1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            var c = cues[mid];
            if (t < c.start) { hi = mid - 1; }
            else if (t > c.end) { lo = mid + 1; }
            else { return c.text; }
        }
        return '';
    }

    var _lastCueText = null;

    function onSubTimeUpdate() {
        if (subState.activeTrack < 0 || !subState.cues.length) {
            if (_lastCueText !== '') {
                subtitleText.textContent = '';
                _lastCueText = '';
            }
            return;
        }
        var found = findCue(subState.cues, v.currentTime);
        if (found !== _lastCueText) {
            subtitleText.textContent = found;
            _lastCueText = found;
        }
    }

    v.addEventListener('timeupdate', onSubTimeUpdate);

    if (subState.cueTimer) {
        clearInterval(subState.cueTimer);
        subState.cueTimer = null;
    }

    function fetchSub(url) {
        var targetUrl = url.startsWith('http') ? (PROXY + encodeURIComponent(url)) : url;
        return fetch(targetUrl)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (text) {
                var t = text.trim();
                if (t.length < 10) throw new Error('empty');
                if (t.startsWith('#EXTM3U')) throw new Error('HLS');
                if (t.startsWith('{') || t.startsWith('[')) throw new Error('JSON');
                var cues = parseCues(t);
                if (!cues.length) throw new Error('no cues');
                return cues;
            });
    }

    var subReq = window.subtitlesPromise || fetch(vylaEndpoint).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    });

    subReq
        .then(function (d) {
            var subs = Array.isArray(d) ? d : (d.subtitles || []);
            subs = subs.filter(function (s) { return s && (s.file || s.url) && s.label; });

            if (!subs.length) {
                if (inlineEl) {
                    inlineEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:14px;">None available</div>';
                    inlineEl.style.display = 'block';
                }
                return;
            }

            window.availableSubtitles = subs;
            var groups = {};
            subs.forEach(function (sub, i) {
                sub._idx = i;
                var lang = sub.label || 'Unknown';
                var base = lang.replace(/\d+$/, '').trim().split(' ')[0];
                if (!groups[base]) groups[base] = { label: base, subs: [] };
                groups[base].subs.push(sub);
            });

            window._buildLangGroups = function () {
                if (!inlineEl) return;
                inlineEl.innerHTML = '';
                inlineEl.style.display = 'block';

                Object.keys(groups).forEach(function (lang) {
                    var g = groups[lang];
                    var code = window.getLangCode ? window.getLangCode(g.label) : '';
                    var row = document.createElement('div');
                    row.className = 'sub-lang-group-item';
                    row.innerHTML =
                        (window.flagImg ? window.flagImg(code) : '') +
                        '<span class="slg-name">' + g.label + '</span>' +
                        '<span class="slg-count">' + g.subs.length + '</span>' +
                        '<i class="fa-solid fa-chevron-right slg-chevron"></i>';

                    row.addEventListener('click', function () {
                        window.haptic(6);
                        showSubEntries(g.label, g.subs, code);
                    });
                    inlineEl.appendChild(row);
                });
            };

            window._buildLangGroups();
        })
        .catch(function () {
            if (inlineEl) {
                inlineEl.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:14px;">None available</div>';
                inlineEl.style.display = 'block';
            }
        });

    function showSubEntries(langLabel, subs, code) {
        var inlineEl = document.getElementById('sub-entries-inline');
        if (!inlineEl) return;
        inlineEl.innerHTML = '';

        var specialList = document.querySelector('#sub-lang-group-view .sub-special-list');
        var sectionDivider = document.getElementById('sub-section-divider');
        var svshTitle = document.querySelector('#sub-lang-group-view .svsh-title');
        var customizeBtn = document.getElementById('sub-customize-open-btn');
        var svshBack = document.querySelector('#sub-lang-group-view .svsh-back');

        if (specialList) specialList.style.display = 'none';
        if (sectionDivider) sectionDivider.style.display = 'none';
        if (customizeBtn) customizeBtn.style.display = 'none';

        var titleCode = code || (typeof getLangCode === 'function' ? getLangCode(langLabel) : '');
        if (svshTitle) {
            svshTitle.innerHTML = (titleCode ? '<img class="slg-flag" src="https://flagcdn.com/20x15/' + titleCode + '.png" width="20" height="15" style="border-radius:2px;object-fit:cover;vertical-align:middle;margin-right:6px;">' : '') + langLabel;
        }

        var _origBack = null;
        if (svshBack) {
            _origBack = svshBack.cloneNode(true);
            svshBack.replaceWith(_origBack);
            _origBack.addEventListener('click', function () {
                inlineEl.innerHTML = '';
                if (specialList) specialList.style.display = '';
                if (sectionDivider) sectionDivider.style.display = '';
                if (customizeBtn) customizeBtn.style.display = '';
                if (svshTitle) svshTitle.textContent = 'Subtitles';
                if (typeof window._buildLangGroups === 'function') window._buildLangGroups();
                var newBack = document.querySelector('#sub-lang-group-view .svsh-back');
                if (newBack) {
                    newBack.addEventListener('click', function () {
                        if (typeof showSettingsView === 'function') showSettingsView('main');
                        if (typeof window.haptic === 'function') window.haptic(6);
                    });
                }
                if (typeof window.haptic === 'function') window.haptic(6);
            });
        }

        subs.forEach(function (sub) {
            var row = document.createElement('div');
            row.className = 'sub-entry-row';
            var url = sub.file || sub.url || '';
            var shortUrl = url.replace(/^https?:\/\//, '').substring(0, 28) + (url.length > 28 ? '\u2026' : '');
            var fmtLabel = (sub.format || sub.type || (url.toLowerCase().includes('.srt') ? 'srt' : 'vtt')).toUpperCase();
            var srcName = sub.source || '';
            var entryCode = code || (typeof getLangCode === 'function' ? getLangCode(langLabel) : '');
            var entryFlag = entryCode
                ? '<img src="https://flagcdn.com/20x15/' + entryCode + '.png" width="26" height="20" style="border-radius:3px;object-fit:cover;flex-shrink:0;" alt="">'
                : '<i class="fa-solid fa-globe" style="font-size:13px;color:var(--white-45);width:26px;text-align:center;"></i>';
            row.innerHTML =
                entryFlag +
                '<div class="se-info">' +
                '<span class="se-url">' + shortUrl + '</span>' +
                '<div class="se-badges">' +
                '<span class="window.fmt-badge">' + fmtLabel + '</span>' +
                (srcName ? '<span class="window.fmt-badge se-src-badge">' + srcName.toUpperCase() + '</span>' : '') +
                '</div></div>' +
                '<i class="fa-solid fa-language se-lang-icon"></i>';

            row.addEventListener('mouseenter', function () { this.style.background = 'rgba(255,255,255,0.06)'; });
            row.addEventListener('mouseleave', function () {
                if (!this.dataset.active) this.style.background = '';
            });

            row.addEventListener('click', function () {
                row.style.opacity = '0.5';
                if (typeof fetchSub === 'function') {
                    fetchSub(url)
                        .then(function (cues) {
                            inlineEl.querySelectorAll('.sub-entry-row').forEach(function (el) {
                                el.removeAttribute('data-active');
                                el.style.background = '';
                            });
                            row.setAttribute('data-active', '1');
                            row.style.background = 'rgba(255,255,255,0.1)';
                            row.style.opacity = '';
                            subState.activeTrack = sub._idx;
                            subState.cues = cues;
                            _lastCueText = null;
                            document.getElementById('lbl-subtitle').textContent = langLabel;
                            var offCheck = document.getElementById('sub-off-check');
                            if (offCheck) offCheck.style.display = 'none';
                            var mainToggle = document.getElementById('subtitle-toggle');
                            if (mainToggle) mainToggle.classList.add('on');
                            if (typeof window.haptic === 'function') window.haptic(6);
                            if (typeof closeSettings === 'function') closeSettings();
                        })
                        .catch(function () {
                            row.style.opacity = '';
                        });
                }
            });

            inlineEl.appendChild(row);
        });

        inlineEl.style.display = '';
    }

    function openSettings() {
        settingsOpen = true;
        showSettingsView('main');
        document.getElementById('settings-modal-wrap').classList.add('open');
        document.getElementById('settings-overlay-backdrop').classList.add('open');
        showUI(true);
        window.haptic(10);
    }

    function closeSettings() {
        settingsOpen = false;
        document.getElementById('settings-modal-wrap').classList.remove('open');
        document.getElementById('settings-overlay-backdrop').classList.remove('open');
        if (!v.paused) {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(hideUI, 3200);
        }
    }

    function showSettingsView(name) {
        document.querySelectorAll('.settings-view').forEach(function (el) {
            el.classList.remove('active');
            el.style.display = 'none';
        });
        var target = document.getElementById('settings-view-' + name);
        if (target) {
            target.style.display = 'flex';
            target.classList.add('active');
            if (name === 'subtitles') {
                document.getElementById('sub-lang-group-view').style.display = 'flex';
                document.getElementById('sub-custom-view').style.display = 'none';
            }
        }
    }

    btnSettings.addEventListener('click', function (e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        settingsOpen ? closeSettings() : openSettings();
    });

    var settingsCloseBtn = document.getElementById('settings-close-btn');
    if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeSettings();
    });

    document.getElementById('settings-overlay-backdrop').addEventListener('click', function () {
        closeSettings();
    });

    document.getElementById('main-watchparty-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        showSettingsView('watchparty');
        window.haptic(6);
    });

    document.getElementById('main-segment-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        showSettingsView('segments');
        window.haptic(6);
        initSegmentsView();
    });

    var _segmentsData = null;
    var _segmentsLoaded = false;

    var _skipSegments = [];

    function msToFmt(ms) {
        if (ms == null) return '0';
        var s = Math.floor(ms / 1000);
        var m = Math.floor(s / 60);
        s = s % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    var segTypeConfig = {
        intro: { label: 'Intro', icon: 'fa-clapperboard', color: 'var(--white)', btnLabel: 'Skip Intro' },
        recap: { label: 'Recap', icon: 'fa-clock-rotate-left', color: 'var(--white)', btnLabel: 'Skip Recap' },
        credits: { label: 'Credits', icon: 'fa-film', color: 'var(--white)', btnLabel: 'Skip Credits' },
        preview: { label: 'Preview', icon: 'fa-forward', color: 'var(--white)', btnLabel: 'Skip Preview' }
    };

    function renderSegmentsView() {
        var cont = document.getElementById('seg-content');
        if (!cont) return;

        if (!_segmentsData) {
            cont.innerHTML =
                '<div class="seg-empty">' +
                '<div class="seg-empty-icon"><i class="fa-solid fa-film"></i></div>' +
                '<div class="seg-empty-title">No segments found</div>' +
                '<div class="seg-empty-desc">No skip segments are available for this title yet.</div>' +
                '</div>';
            return;
        }

        var types = ['intro', 'recap', 'credits', 'preview'];
        var found = [];

        types.forEach(function (t) {
            var arr = _segmentsData[t];
            if (arr && arr.length) {
                arr.forEach(function (seg, idx) {
                    if (seg.start_ms != null || seg.end_ms != null) {
                        found.push({ type: t, seg: seg, idx: idx });
                    }
                });
            }
        });

        if (!found.length) {
            cont.innerHTML =
                '<div class="seg-empty">' +
                '<div class="seg-empty-title">No skip segments</div>' +
                '<div class="seg-empty-desc">This title has no skippable segments in the database.</div>' +
                '</div>';
            return;
        }

        var html = '<div class="seg-list">';

        found.forEach(function (item) {
            var cfg = segTypeConfig[item.type] || { label: item.type, icon: 'fa-forward', color: '#888' };
            var seg = item.seg;
            var startStr = msToFmt(seg.start_ms);
            var endStr = msToFmt(seg.end_ms);

            html +=
                '<div class="seg-item">' +
                '<div class="seg-icon" style="background:' + cfg.color + '20;">' +
                '<i class="fa-solid ' + cfg.icon + '" style="color:' + cfg.color + ';"></i>' +
                '</div>' +
                '<div class="seg-info">' +
                '<div class="seg-label">' +
                cfg.label +
                (found.filter(function (f) { return f.type === item.type; }).length > 1 ? ' ' + (item.idx + 1) : '') +
                '</div>' +
                '<div class="seg-time">' + startStr + ' - ' + endStr + '</div>' +
                '</div>' +
                '</div>';
        });

        html += '</div>';
        cont.innerHTML = html;
    }

    function setupSkipButtons() {
        if (!_segmentsData) return;
        _skipSegments = [];
        var types = ['intro', 'recap', 'credits', 'preview'];
        types.forEach(function (t) {
            var arr = _segmentsData[t];
            if (!arr || !arr.length) return;
            arr.forEach(function (seg) {
                var cfg = segTypeConfig[t] || { btnLabel: 'Skip' };
                _skipSegments.push({
                    start: seg.start_ms != null ? seg.start_ms / 1000 : 0,
                    end: seg.end_ms != null ? seg.end_ms / 1000 : (v.duration || 0),
                    label: cfg.btnLabel
                });
            });
        });

        var skipBtn = document.getElementById('skip-segment-btn');
        var skipLbl = document.getElementById('skip-segment-label');

        v.addEventListener('timeupdate', function () {
            if (!_skipSegments.length) return;
            var ct = v.currentTime;
            var active = null;
            for (var i = 0; i < _skipSegments.length; i++) {
                var seg = _skipSegments[i];
                if (ct >= seg.start && ct < seg.end) { active = seg; break; }
            }
            if (active) {
                skipLbl.textContent = active.label;
                skipBtn.classList.add('show');
                skipBtn._activeSeg = active;
            } else {
                skipBtn.classList.remove('show');
                skipBtn._activeSeg = null;
            }
        });

        skipBtn.addEventListener('click', function () {
            var seg = this._activeSeg;
            if (seg) {
                v.currentTime = seg.end;
                window.haptic(6);
            }
        });

        function updateSegmentEndTimes() {
            if (v.duration && v.duration > 0) {
                _skipSegments.forEach(function (seg) {
                    if (seg.end === 0 || isNaN(seg.end)) {
                        seg.end = v.duration;
                    }
                });
            }
        }

        v.addEventListener('loadedmetadata', updateSegmentEndTimes);
        v.addEventListener('durationchange', updateSegmentEndTimes);
    }

    (function () {
        initSegmentsView();
    })();

    (function () {
        var wpState = {
            active: false,
            isHost: false,
            roomCode: null,
            peer: null,
            connections: [],
            hostConn: null,
            overlayOn: false,
            members: 1,
            syncInterval: null,
            lockControls: false,
            disconnected: false,
            lastRoomCode: null
        };

        var wpMainView = document.getElementById('wp-main-view');
        var wpJoinView = document.getElementById('wp-join-view');
        var wpHostingView = document.getElementById('wp-hosting-view');
        var wpHostBtn = document.getElementById('wp-host-btn');
        var wpJoinBtn = document.getElementById('wp-join-btn');
        var wpJoinCancelBtn = document.getElementById('wp-join-cancel-btn');
        var wpJoinConfirmBtn = document.getElementById('wp-join-confirm-btn');
        var wpCodeInput = document.getElementById('wp-code-input');
        var wpRoomCode = document.getElementById('wp-room-code');
        var wpLeaveBtn = document.getElementById('wp-leave-btn');
        var wpReconnectBtn = document.getElementById('wp-reconnect-btn');
        var wpCodeDisplay = document.getElementById('wp-code-display');
        var wpMembersList = document.getElementById('wp-members-list');
        var wpOverlayToggle = document.getElementById('wp-overlay-toggle');
        var wpBackendLabel = document.getElementById('wp-backend-label');
        var wpBackendName = document.getElementById('wp-backend-name');

        if (wpBackendLabel) wpBackendLabel.textContent = 'P2P via WebRTC (PeerJS)';
        if (wpBackendName) wpBackendName.textContent = 'PeerJS';

        function genCode() {
            var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            var code = '';
            for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
            return code;
        }

        function showWpView(name) {
            if (wpMainView) wpMainView.style.display = 'none';
            if (wpJoinView) wpJoinView.style.display = 'none';
            if (wpHostingView) wpHostingView.style.display = 'none';
            if (name === 'main' && wpMainView) wpMainView.style.display = 'flex';
            else if (name === 'join' && wpJoinView) wpJoinView.style.display = 'flex';
            else if (name === 'hosting' && wpHostingView) wpHostingView.style.display = 'flex';
        }

        function updateMembersLabel() {
            if (wpMembersList) {
                if (wpState.members <= 1) {
                    wpMembersList.textContent = '\u25b8 Alone — share the code!';
                } else {
                    wpMembersList.textContent = '\u25b8 ' + wpState.members + ' watching together';
                }
            }
        }

        function setGuestLock(locked) {
            wpState.lockControls = locked;
            var lockBanner = document.getElementById('wp-guest-lock-banner');
            if (locked) {
                if (!lockBanner) {
                    lockBanner = document.createElement('div');
                    lockBanner.id = 'wp-guest-lock-banner';
                    lockBanner.style.cssText = 'position:absolute;bottom:72px;left:50%;transform:translateX(-50%);z-index:28;background:rgba(0,0,0,0.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:100px;padding:7px 18px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);pointer-events:none;white-space:nowrap;display:flex;align-items:center;gap:7px;';
                    lockBanner.innerHTML = '<i class="fa-solid fa-lock" style="font-size:11px;"></i> Host controls playback';
                    document.getElementById('player').appendChild(lockBanner);
                }
                lockBanner.style.display = 'flex';
                var btnPlay = document.getElementById('btn-play');
                if (btnPlay) btnPlay.style.opacity = '0.35';
                var trackWrap = document.getElementById('track-wrap');
                if (trackWrap) trackWrap.style.pointerEvents = 'none';
            } else {
                if (lockBanner) lockBanner.style.display = 'none';
                var btnPlay = document.getElementById('btn-play');
                if (btnPlay) btnPlay.style.opacity = '';
                var trackWrap = document.getElementById('track-wrap');
                if (trackWrap) trackWrap.style.pointerEvents = '';
            }
        }

        function normalizeWpSourceUrl(url) {
            if (!url) return '';
            try { return decodeURIComponent(String(url).trim()); } catch (ex) { return String(url || '').trim(); }
        }

        function getActiveWpSourceUrl() {
            return normalizeWpSourceUrl(window._activeMediaUrl || v.currentSrc || v.src || '');
        }

        function getCurrentSourceMeta() {
            var source = Array.isArray(sources) && sources[currentSourceIndex] ? sources[currentSourceIndex] : null;
            var label = source ? (source.label || source.source || 'Source') : (window._activeSourceLabel || 'Source');
            var resolvedUrl = source && source.url ? source.url : (window._activeMediaUrl || '');
            return {
                label: label,
                index: typeof currentSourceIndex === 'number' ? currentSourceIndex : -1,
                url: resolvedUrl,
                sourceKey: source ? (source.key || source.source || '') : ''
            };
        }

        function applySourceMetaFromMessage(msg) {
            if (!msg) return;
            var sourceUrl = msg.url || msg.sourceUrl || '';
            if (msg.sourceLabel) {
                window._activeSourceLabel = String(msg.sourceLabel).trim();
                var lblSource = document.getElementById('lbl-source');
                if (lblSource) {
                    var labelText = window._activeSourceLabel.charAt(0).toUpperCase() + window._activeSourceLabel.slice(1);
                    lblSource.textContent = labelText;
                }
            }
            if (typeof msg.sourceIndex === 'number' && Array.isArray(sources) && sources[msg.sourceIndex]) {
                currentSourceIndex = msg.sourceIndex;
                window._activeSourceLabel = sources[msg.sourceIndex].label || sources[msg.sourceIndex].source || window._activeSourceLabel || 'Source';
                if (sourceUrl && !sources[msg.sourceIndex].url) {
                    sources[msg.sourceIndex].url = sourceUrl;
                }
            }
            if (sourceUrl && Array.isArray(sources)) {
                var matchingSource = sources.find(function (candidate) {
                    return candidate && normalizeWpSourceUrl(candidate.url || '') === normalizeWpSourceUrl(sourceUrl);
                });
                if (matchingSource) {
                    currentSourceIndex = sources.indexOf(matchingSource);
                    window._activeSourceLabel = matchingSource.label || matchingSource.source || window._activeSourceLabel || 'Source';
                    if (!matchingSource.url) matchingSource.url = sourceUrl;
                }
            }
            if (typeof buildSourceList === 'function') buildSourceList();
        }

        function buildWpMessage(type, time, paused) {
            var sourceMeta = getCurrentSourceMeta();
            return {
                type: type,
                time: time,
                paused: paused,
                src: getActiveWpSourceUrl(),
                sourceLabel: sourceMeta.label,
                sourceIndex: sourceMeta.index,
                sourceUrl: sourceMeta.url,
                sourceKey: sourceMeta.sourceKey
            };
        }

        function broadcastToGuests(msg) {
            wpState.connections.forEach(function (conn) {
                if (conn.open) {
                    try { conn.send(msg); } catch (ex) { }
                }
            });
        }

        function applyRemoteEvent(msg) {
            if (!msg || !msg.type) return;
            applySourceMetaFromMessage(msg);
            var remoteSrc = normalizeWpSourceUrl(msg.src || msg.sourceUrl || '');
            var currentSrc = getActiveWpSourceUrl();
            var needsSourceSync = !!remoteSrc && (!currentSrc || remoteSrc !== currentSrc);
            var shouldResumePlayback = msg.type === 'play' || (msg.type === 'sync' && !msg.paused);
            if (msg.type === 'play') {
                if (Math.abs(v.currentTime - msg.time) > 0.5) v.currentTime = msg.time;
                if (!needsSourceSync) {
                    v.play().catch(function () { });
                } else {
                    try { switchSource(remoteSrc, false, shouldResumePlayback); } catch (ex) { try { window.play(remoteSrc, window.store && window.store.id ? window.store.id : null); } catch (ex2) { } }
                }
            } else if (msg.type === 'pause') {
                if (Math.abs(v.currentTime - msg.time) > 0.5) v.currentTime = msg.time;
                if (!needsSourceSync) {
                    v.pause();
                } else {
                    try { switchSource(remoteSrc, false, shouldResumePlayback); } catch (ex) { }
                }
            } else if (msg.type === 'seek') {
                if (!needsSourceSync) {
                    v.currentTime = msg.time;
                } else {
                    try { switchSource(remoteSrc, false, false); } catch (ex) { }
                }
            } else if (msg.type === 'sync') {
                if (needsSourceSync) {
                    try {
                        if (msg.sourceUrl && Array.isArray(sources)) {
                            var matchingSource = sources.find(function (candidate) { return candidate && normalizeWpSourceUrl(candidate.url || '') === remoteSrc; });
                            if (matchingSource) {
                                currentSourceIndex = sources.indexOf(matchingSource);
                                window._activeSourceLabel = matchingSource.label || matchingSource.source || window._activeSourceLabel || 'Source';
                                if (!matchingSource.url) matchingSource.url = remoteSrc;
                            }
                        }
                        switchSource(remoteSrc, false, shouldResumePlayback);
                    } catch (ex) { try { window.play(remoteSrc, window.store && window.store.id ? window.store.id : null); } catch (ex2) { } }
                    return;
                }
                var diff = v.currentTime - msg.time;
                if (!v.paused && Math.abs(diff) > 1.5) {
                    v.currentTime = msg.time;
                }
                if (msg.paused && !v.paused) v.pause();
                if (!msg.paused && v.paused) v.play().catch(function () { });
            } else if (msg.type === 'member_count') {
                wpState.members = msg.count;
                updateMembersLabel();
                updateWatchPartyOverlay();
            }
        }

        function attachHostVideoListeners() {
            v.addEventListener('play', function () {
                var icon = document.getElementById('play-btn-icon');
                if (icon) icon.className = 'fa-solid fa-pause';
            });
            v.addEventListener('pause', function () {
                var icon = document.getElementById('play-btn-icon');
                if (icon) icon.className = 'fa-solid fa-play';
            });
            v.addEventListener('seeked', function () {
                if (!wpState.active || !wpState.isHost) return;
                broadcastToGuests(buildWpMessage('seek', v.currentTime, v.paused));
            });
        }

        attachHostVideoListeners();

        function startSyncInterval() {
            clearInterval(wpState.syncInterval);
            wpState.syncInterval = setInterval(function () {
                if (!wpState.active || !wpState.isHost) return;
                broadcastToGuests(buildWpMessage('sync', v.currentTime, v.paused));
            }, 5000);
        }

        function initPeer(peerId, onReady) {
            if (typeof Peer === 'undefined') {
                var script = document.createElement('script');
                script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
                script.onload = function () { createPeer(peerId, onReady); };
                script.onerror = function () {
                    showWpError('Failed to load PeerJS. Check your connection.');
                };
                document.head.appendChild(script);
            } else {
                createPeer(peerId, onReady);
            }
        }

        function createPeer(peerId, onReady) {
            if (wpState.peer) {
                try { wpState.peer.destroy(); } catch (ex) { }
            }
            var peer = new Peer(peerId, { debug: 0 });
            wpState.peer = peer;

            peer.on('open', function (id) {
                onReady(id);
            });

            peer.on('error', function (err) {
                var msg = err.type === 'unavailable-id'
                    ? 'Room code already in use. Try a different one.'
                    : err.type === 'peer-unavailable'
                        ? 'Room not found. Check the code and try again.'
                        : 'Connection error: ' + (err.message || err.type);
                showWpError(msg);
                leaveParty();
            });

            peer.on('connection', function (conn) {
                conn.on('open', function () {
                    wpState.connections.push(conn);
                    wpState.members = 1 + wpState.connections.length;
                    updateMembersLabel();
                    updateWatchPartyOverlay();
                    broadcastToGuests({ type: 'member_count', count: wpState.members });
                    try { conn.send(buildWpMessage('sync', v.currentTime, v.paused)); } catch (ex) { }
                    setTimeout(function () {
                        try { conn.send(buildWpMessage('sync', v.currentTime, v.paused)); } catch (ex) { }
                    }, 800);
                });
                conn.on('data', function (msg) {
                    if (msg && msg.type === 'request_sync') {
                        try { conn.send(buildWpMessage('sync', v.currentTime, v.paused)); } catch (ex) { }
                    }
                });
                conn.on('close', function () {
                    wpState.connections = wpState.connections.filter(function (c) { return c !== conn; });
                    wpState.members = 1 + wpState.connections.length;
                    updateMembersLabel();
                    updateWatchPartyOverlay();
                    broadcastToGuests({ type: 'member_count', count: wpState.members });
                });
                conn.on('error', function () {
                    wpState.connections = wpState.connections.filter(function (c) { return c !== conn; });
                    wpState.members = 1 + wpState.connections.length;
                    updateMembersLabel();
                });
            });
        }

        function showWpError(msg) {
            var err = document.getElementById('wp-error-msg');
            if (!err) {
                err = document.createElement('div');
                err.id = 'wp-error-msg';
                err.style.cssText = 'font-size:13px;color:#ff6b6b;text-align:center;padding:10px 16px;line-height:1.5;';
                if (wpMainView) {
                    wpMainView.insertBefore(err, wpMainView.firstChild);
                }
            }
            err.textContent = msg;
            err.style.display = 'block';
            setTimeout(function () { if (err) err.style.display = 'none'; }, 5000);
        }

        function setWpBtnLoading(btn, loading, text) {
            if (!btn) return;
            btn.disabled = loading;
            btn.textContent = loading ? 'Connecting\u2026' : text;
        }

        function startHosting() {
            if (typeof window.setWatchPartySourceMode === 'function') {
                window.setWatchPartySourceMode(false);
            }
            var code = genCode();
            var peerId = 'vyla-wp-' + code;
            setWpBtnLoading(wpHostBtn, true, 'Host a Watch Party');
            initPeer(peerId, function (id) {
                setWpBtnLoading(wpHostBtn, false, 'Host a Watch Party');
                wpState.active = true;
                wpState.isHost = true;
                wpState.roomCode = code;
                wpState.members = 1;
                wpState.connections = [];
                if (wpRoomCode) wpRoomCode.textContent = code;
                updateMembersLabel();
                showWpView('hosting');
                updateWatchPartyOverlay();
                startSyncInterval();
                setGuestLock(false);
            });
        }

        function joinParty(code) {
            if (typeof window.setWatchPartySourceMode === 'function') {
                window.setWatchPartySourceMode(true);
            }
            var cleanCode = code.toUpperCase().trim();
            var peerId = 'vyla-wp-guest-' + Math.random().toString(36).slice(2, 8);
            var hostPeerId = 'vyla-wp-' + cleanCode;
            setWpBtnLoading(wpJoinConfirmBtn, true, 'Join');
            initPeer(peerId, function () {
                var conn = wpState.peer.connect(hostPeerId, { reliable: true });
                wpState.hostConn = conn;
                var connTimeout = setTimeout(function () {
                    setWpBtnLoading(wpJoinConfirmBtn, false, 'Join');
                    showWpError('Could not reach that room. Is the code correct?');
                    showWpView('join');
                }, 10000);

                conn.on('open', function () {
                    clearTimeout(connTimeout);
                    setWpBtnLoading(wpJoinConfirmBtn, false, 'Join');
                    wpState.active = true;
                    wpState.isHost = false;
                    wpState.roomCode = cleanCode;
                    wpState.lastRoomCode = cleanCode;
                    wpState.disconnected = false;
                    wpState.members = 2;
                    if (wpRoomCode) wpRoomCode.textContent = cleanCode;
                    updateMembersLabel();
                    showWpView('hosting');
                    updateWatchPartyOverlay();
                    setGuestLock(true);
                    if (wpReconnectBtn) {
                        wpReconnectBtn.style.display = 'none';
                    }
                    if (wpLeaveBtn) {
                        wpLeaveBtn.style.display = 'block';
                    }
                    setTimeout(function () {
                        try { conn.send({ type: 'request_sync' }); } catch (ex) { }
                    }, 250);
                });

                conn.on('data', function (msg) {
                    applyRemoteEvent(msg);
                });

                conn.on('close', function () {
                    if (!wpState.active) return;
                    wpState.disconnected = true;
                    wpState.lastRoomCode = wpState.roomCode;
                    showWpError('Host disconnected.');
                    if (wpReconnectBtn) {
                        wpReconnectBtn.style.display = 'block';
                    }
                    if (wpLeaveBtn) {
                        wpLeaveBtn.style.display = 'none';
                    }
                });

                conn.on('error', function () {
                    clearTimeout(connTimeout);
                    setWpBtnLoading(wpJoinConfirmBtn, false, 'Join');
                    showWpError('Could not reach that room. Is the code correct?');
                    showWpView('join');
                });
            });
        }

        function leaveParty() {
            if (typeof window.setWatchPartySourceMode === 'function') {
                window.setWatchPartySourceMode(false);
            }
            clearInterval(wpState.syncInterval);
            wpState.syncInterval = null;
            if (wpState.hostConn) {
                try { wpState.hostConn.close(); } catch (ex) { }
                wpState.hostConn = null;
            }
            wpState.connections.forEach(function (c) { try { c.close(); } catch (ex) { } });
            wpState.connections = [];
            if (wpState.peer) {
                try { wpState.peer.destroy(); } catch (ex) { }
                wpState.peer = null;
            }
            wpState.active = false;
            wpState.isHost = false;
            wpState.roomCode = null;
            wpState.members = 1;
            wpState.disconnected = false;
            wpState.lastRoomCode = null;
            setGuestLock(false);
            if (wpReconnectBtn) {
                wpReconnectBtn.style.display = 'none';
            }
            if (wpLeaveBtn) {
                wpLeaveBtn.style.display = 'block';
            }
            showWpView('main');
            updateWatchPartyOverlay();
        }

        function updateWatchPartyOverlay() {
            var existing = document.getElementById('wp-status-overlay');
            if (!wpState.active) {
                if (existing) existing.style.display = 'none';
                return;
            }
            if (!existing) {
                existing = document.createElement('div');
                existing.id = 'wp-status-overlay';
                existing.style.cssText = 'position:absolute;top:10px;right:10px;z-index:25;background:rgba(0,0,0,0.7);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:12px;padding:8px 14px;display:flex;flex-direction:column;gap:3px;pointer-events:none;min-width:140px;';
                document.getElementById('player').appendChild(existing);
            }
            if (!wpState.overlayOn) {
                existing.style.display = 'none';
                return;
            }
            existing.style.display = '';
            existing.innerHTML =
                '<div style="display:flex;align-items:center;gap:7px;">' +
                '<i class="fa-solid fa-podcast" style="font-size:11px;color:var(--white);"></i>' +
                '<span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.9);">' + (wpState.isHost ? 'Hosting' : 'Watching') + '</span>' +
                '<span style="font-size:13px;font-weight:700;color:var(--white);letter-spacing:0.08em;">' + wpState.roomCode + '</span>' +
                '</div>' +
                '<div style="font-size:11px;color:rgba(255,255,255,0.55);">\u25b8 ' + (wpState.members <= 1 ? 'Alone' : wpState.members + ' watching') + '</div>';
        }

        if (wpHostBtn) {
            wpHostBtn.addEventListener('click', function () { startHosting(); window.haptic(6); });
        }

        if (wpJoinBtn) {
            wpJoinBtn.addEventListener('click', function () {
                showWpView('join');
                wpCodeInput.value = '';
                setTimeout(function () { wpCodeInput.focus(); }, 120);
                window.haptic(6);
            });
        }

        if (wpJoinCancelBtn) {
            wpJoinCancelBtn.addEventListener('click', function () { showWpView('main'); window.haptic(6); });
        }

        if (wpJoinConfirmBtn) {
            wpJoinConfirmBtn.addEventListener('click', function () {
                var code = wpCodeInput.value.trim();
                if (!code) return;
                joinParty(code);
                window.haptic(6);
            });
        }

        if (wpCodeInput) {
            wpCodeInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { wpJoinConfirmBtn.click(); }
            });
        }

        if (wpLeaveBtn) {
            wpLeaveBtn.addEventListener('click', function () { leaveParty(); window.haptic(6); });
        }

        if (wpReconnectBtn) {
            wpReconnectBtn.addEventListener('click', function () {
                if (wpState.disconnected && wpState.lastRoomCode) {
                    wpState.disconnected = false;
                    if (wpReconnectBtn) {
                        wpReconnectBtn.style.display = 'none';
                    }
                    if (wpLeaveBtn) {
                        wpLeaveBtn.style.display = 'block';
                    }

                    if (wpCodeInput) {
                        wpCodeInput.value = wpState.lastRoomCode;
                    }
                    if (wpJoinConfirmBtn) {
                        wpJoinConfirmBtn.click();
                    }
                }
                window.haptic(6);
            });
        }

        if (wpCodeDisplay) {
            wpCodeDisplay.addEventListener('click', function () {
                var link = location.origin + location.pathname + location.search + '&wp=' + wpState.roomCode;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(link).then(function () {
                        var icon = wpCodeDisplay.querySelector('i');
                        if (icon) { icon.className = 'fa-solid fa-check'; setTimeout(function () { icon.className = 'fa-solid fa-copy'; }, 1500); }
                    }).catch(function () { });
                }
                window.haptic(6);
            });
        }

        var btnSubShortcut = document.getElementById('btn-subtitles-shortcut');
        if (btnSubShortcut) {
            btnSubShortcut.addEventListener('click', function (e) {
                e.stopPropagation();
                openSettings();
                showSettingsView('subtitles');
            });
        }

        if (wpOverlayToggle) {
            wpOverlayToggle.addEventListener('click', function () {
                wpState.overlayOn = !wpState.overlayOn;
                this.classList.toggle('on', wpState.overlayOn);
                updateWatchPartyOverlay();
                window.haptic(6);
            });
        }

        document.addEventListener('keydown', function (e) {
            if (!wpState.lockControls) return;
            if (e.key === ' ' || e.key === 'k' || e.key === 'K') { e.stopImmediatePropagation(); e.preventDefault(); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); }
        }, true);

        var settingsViewWatchparty = document.getElementById('settings-view-watchparty');
        if (settingsViewWatchparty) {
            settingsViewWatchparty.addEventListener('click', function (e) {
                e.stopPropagation();
            });
        }

        var hashWp = (location.hash.match(/wp=([A-Z0-9]+)/) || [])[1] || (new URLSearchParams(location.search).get('wp') || null);
        if (hashWp) {
            setTimeout(function () {
                document.getElementById('main-watchparty-btn') && document.getElementById('main-watchparty-btn').click();
                if (wpCodeInput) {
                    wpCodeInput.value = hashWp;
                }
                if (wpJoinBtn) {
                    wpJoinBtn.click();
                }
                setTimeout(function () {
                    if (wpCodeInput) {
                        wpCodeInput.value = hashWp;
                    }
                    if (wpJoinConfirmBtn) {
                        wpJoinConfirmBtn.click();
                    }
                }, 200);
            }, 1500);
        }
    })();

    document.querySelector('.settings-tile[data-nav="sources"]').addEventListener('click', function (e) {
        e.stopPropagation();
        showSettingsView('sources');
        window.haptic(6);
    });

    document.querySelector('.settings-tile[data-nav="quality"]').addEventListener('click', function (e) {
        e.stopPropagation();
        buildQualityOpts();
        showSettingsView('quality');
        window.haptic(6);
    });

    document.querySelector('.settings-tile[data-nav="subtitles"]').addEventListener('click', function (e) {
        e.stopPropagation();
        showSettingsView('subtitles');
        window.haptic(6);
    });

    document.querySelector('.settings-tile[data-nav="video"]').addEventListener('click', function (e) {
        e.stopPropagation();
        showSettingsView('video');
        window.haptic(6);
    });

    document.querySelectorAll('.settings-back-btn').forEach(function (btn) {
        if (btn.id === 'sub-main-back-btn') return;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            showSettingsView('main');
            window.haptic(6);
        });
    });

    var subtitleToggleEl = document.getElementById('subtitle-toggle');
    if (subtitleToggleEl) {
        subtitleToggleEl.addEventListener('click', function (e) {
            e.stopPropagation();
            if (subState.activeTrack >= 0 || subState.activeTrack === -2) {
                subState.activeTrack = -1;
                subState.customSubId = null;
                subState.cues = [];
                subtitleText.textContent = '';
                _lastCueText = '';
                subtitleToggleEl.classList.remove('on');
                document.getElementById('lbl-subtitle').textContent = 'Off';

                var offItem = document.querySelector('.sub-off-item');
                if (offItem) {
                    document.querySelectorAll('.sub-special-item, .sub-lang-item').forEach(function (x) {
                        x.classList.remove('active-sub-item');
                        var check = x.querySelector('.sub-active-check');
                        if (check) check.style.display = 'none';
                    });
                    offItem.classList.add('active-sub-item');
                    var check = offItem.querySelector('.sub-active-check');
                    if (check) check.style.display = 'block';
                }
                var offCheck = document.getElementById('sub-off-check');
                if (offCheck) offCheck.style.display = 'block';
                if (typeof renderCustomSubList === 'function') renderCustomSubList();
            } else {
                var firstSubItem = document.querySelector('.sub-lang-item:not(.disabled)');
                if (firstSubItem) {
                    firstSubItem.click();
                } else {
                    subtitleToggleEl.classList.remove('on');
                }
            }
            window.haptic(6);
        });

        var btnToggleVr = document.getElementById('btn-toggle-vr');
        if (btnToggleVr) {
            if (!window.isMobile || !window.isMobile()) {
                var vrRow = document.getElementById('vr-toggle-row');
                var vrSub = document.getElementById('vr-mode-sub');
                if (vrRow) vrRow.style.display = 'none';
                if (vrSub) vrSub.style.display = 'none';
            }
            btnToggleVr.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleVrMode(!videoState.vr);
                window.haptic(6);
            });
        }

        var vrSplitSelect = document.getElementById('vr-split-select');
        if (vrSplitSelect) {
            vrSplitSelect.addEventListener('change', function (e) {
                e.stopPropagation();
                videoState.vrSplit = this.value;
                window.haptic(6);
            });
        }

        var speedBoostToggleEl = document.getElementById('speed-boost-toggle');
        if (speedBoostToggleEl) {
            if (!speedBoostEnabled) speedBoostToggleEl.classList.remove('on');
            speedBoostToggleEl.addEventListener('click', function (e) {
                e.stopPropagation();
                speedBoostEnabled = !speedBoostEnabled;
                speedBoostToggleEl.classList.toggle('on', speedBoostEnabled);
                try { localStorage.setItem('speedBoostEnabled', speedBoostEnabled ? 'true' : 'false'); } catch (ex) { }
                window.haptic(6);
            });
        }
    }

    var mainPipBtn = document.getElementById('main-pip-btn');
    if (mainPipBtn) {
        mainPipBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            showSettingsView('download');
            window.haptic(6);
            var list = document.getElementById('download-list');
            if (list.dataset.loaded) return;
            list.dataset.loaded = '1';
            list.innerHTML =
                '<div class="source-skeleton">' +
                '<div class="source-skel-item"></div>' +
                '<div class="source-skel-item"></div>' +
                '<div class="source-skel-item"></div>' +
                '</div>';
            var episode = window.e || 1;
            var _id = (window.id || '').toString().trim();
            var _s = (window.s || '').toString().trim();
            var _base = (window.baseURL || '').toString().trim();
            var p = new URLSearchParams({ tmdbId: _id });
            if (_s) {
                p.set('season', _s);
                p.set('episode', episode);
            }
            var endpoint = _base + '/api/downloads?' + p.toString();
            fetch(endpoint)
                .then(r => {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(data => {
                    var downloads = Array.isArray(data) ? data : (data.downloads || []);
                    if (!downloads.length) {
                        list.innerHTML =
                            '<div style="padding:20px;text-align:center;color:var(--white-45);font-size:14px;">No downloads available.</div>';
                        return;
                    }
                    list.innerHTML = '';
                    downloads.forEach(dl => {
                        var item = document.createElement('a');
                        item.className = 'download-item';
                        item.href = dl.url;
                        item.target = '_blank';
                        item.rel = 'noopener noreferrer';
                        item.innerHTML =
                            '<div class="download-item-left">' +
                            '<span class="download-item-name">' +
                            (dl.quality || 'Download') +
                            (dl.size ? ` <span class="download-item-quality">${dl.size}</span>` : '') +
                            '</span>' +
                            '<span class="download-item-type">' + (dl.format || '') + '</span>' +
                            '</div>' +
                            '<div class="download-item-actions">' +
                            '<i class="fa-solid fa-download"></i>' +
                            '</div>';
                        list.appendChild(item);
                    });
                })
                .catch(() => {
                    list.innerHTML =
                        '<div style="padding:20px;text-align:center;color:var(--white-45);font-size:14px;">Failed to fetch downloads.</div>';
                });
        });
    }

    var mainPlaybackBtn = document.getElementById('main-playback-btn');
    if (mainPlaybackBtn) {
        mainPlaybackBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            showSettingsView('speed');
            window.haptic(6);
        });
    }

    var mainVideoBtn = document.getElementById('main-video-btn');
    if (mainVideoBtn) {
        mainVideoBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            showSettingsView('video');
            window.haptic(6);
        });
    }

    var videoInputs = ['brightness', 'contrast', 'saturate'];
    videoInputs.forEach(function (key) {
        var el = document.getElementById('vid-' + key);
        if (!el) return;
        el.addEventListener('input', function (e) {
            e.stopPropagation();
            videoState[key] = this.value;
            applyVideoStyles();
            updateVideoLabel();
        });
    });

    var ratioOpts = document.querySelectorAll('.settings-list-item[data-ratio]');
    ratioOpts.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            videoState.ratio = this.dataset.ratio;
            applyVideoStyles();
            updateListActive('ratio-opts', this, 'lbl-ratio', this.textContent.trim());
            window.haptic(6);
        });
    });

    var btnResetVideo = document.getElementById('btn-reset-video');
    if (btnResetVideo) {
        btnResetVideo.addEventListener('click', function (e) {
            e.stopPropagation();
            videoState.brightness = 100;
            videoState.contrast = 100;
            videoState.saturate = 100;
            videoState.ratio = 'contain';
            applyVideoStyles();
            updateVideoLabel();
            var el;
            el = document.getElementById('vid-brightness'); if (el) el.value = 100;
            el = document.getElementById('vid-contrast'); if (el) el.value = 100;
            el = document.getElementById('vid-saturate'); if (el) el.value = 100;
            var fitBtn = document.querySelector('.settings-list-item[data-ratio="contain"]');
            if (fitBtn) updateListActive('ratio-opts', fitBtn, 'lbl-ratio', 'Fit');
            window.haptic(6);
        });
    }

    var btnToggleAscii = document.getElementById('btn-toggle-ascii');
    if (btnToggleAscii) {
        btnToggleAscii.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleAsciiMode(!videoState.ascii);
            window.haptic(6);
        });
    }

    var btnToggleAsciiColor = document.getElementById('btn-toggle-ascii-color');
    if (btnToggleAsciiColor) {
        btnToggleAsciiColor.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleAsciiColorMode(!videoState.asciiColor);
            window.haptic(6);
        });
    }

    function updateVideoLabel() {
        var lbl = document.getElementById('lbl-video');
        if (!lbl) return;
        if (videoState.ascii) {
            lbl.textContent = 'ASCII';
            return;
        }
        var isDefault = videoState.brightness == 100 && videoState.contrast == 100 && videoState.saturate == 100 && videoState.ratio === 'contain';
        lbl.textContent = isDefault ? 'Default' : 'Custom';
    }

    speedOpts.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var rate = parseFloat(this.dataset.speed);
            v.playbackRate = rate;
            savedSpeed = rate;
            try { localStorage.setItem('playbackSpeed', rate); } catch (err) { }
            updateListActive('speed-opts', this, 'lbl-speed', this.textContent.trim());
            window.haptic(6);
            showUI(true);
        });
    });

    function switchSource(url, shouldPlayAfterSwitch) {
        var savedTime = v.currentTime || 0;
        _activePlaybackAttempt = true;
        _activePlaybackErrorShown = false;
        _videoErrBlocked = true;
        setTimeout(function () { _videoErrBlocked = false; }, 2000);

        window._activeMediaUrl = url;

        if (window.hls && typeof window.hls.destroy === 'function') {
            window.hls.destroy();
            window.hls = null;
        }
        if (window.dashPlayer && typeof window.dashPlayer.destroy === 'function') {
            window.dashPlayer.destroy();
            window.dashPlayer = null;
        }

        v.pause();
        v.src = '';
        v.removeAttribute('src');
        v.load();

        showBufferingImmediate();

        if (isDashUrl(url)) {
            ensureDashJs(function () { initDash(url, savedTime, shouldPlayAfterSwitch, false); });
            return;
        }

        var isHls = !isDirectMediaUrl(url);

        if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
            initHls(url, savedTime, shouldPlayAfterSwitch);
        } else {
            v.src = url;
            v.load();

            var onNativeError = function () {
                v.removeEventListener('error', onNativeError);
                if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                    initHls(url, savedTime, shouldPlayAfterSwitch);
                } else {
                    showPlaybackError('Format not supported');
                }
            };
            v.addEventListener('error', onNativeError);

            var onLoadedMeta = function () {
                v.removeEventListener('loadedmetadata', onLoadedMeta);
                hideBuffering();
                var loaderBottomGlow = document.querySelector('.loader-bottom-glow');
                if (loaderBottomGlow) loaderBottomGlow.classList.add('video-playing');
                onReady();
                startDurationPoll();
            };
            v.addEventListener('loadedmetadata', onLoadedMeta);

            var p = v.play();
            if (p !== undefined) {
                p.then(function () {
                    if (!isNaN(savedTime) && savedTime > 0) v.currentTime = savedTime;
                }).catch(function (e) {
                    if (e.name === 'NotSupportedError' && typeof Hls !== 'undefined' && Hls.isSupported()) {
                        v.removeEventListener('error', onNativeError);
                        initHls(url, savedTime, shouldPlayAfterSwitch);
                    } else {
                        v.muted = true;
                        v.play().catch(function () { });
                    }
                });
            }
        }
    }

    function initHls(url, savedTime, shouldPlayAfterSwitch) {
        if (window.hls) window.hls.destroy();
        v.pause();
        v.removeAttribute('src');
        v.load();

        window.hls = new Hls({
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            backBufferLength: 30,
            capLevelToPlayerSize: false,
            manifestLoadingMaxRetry: 5,
            manifestLoadingRetryDelay: 1000,
            levelLoadingMaxRetry: 4,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 500,
            xhrSetup: function (xhr, url) {
                if (url.startsWith(window.baseURL)) {
                    var token = window.store && window.store.sessionToken;
                    if (token) xhr.setRequestHeader('X-Session-Token', token);
                }
            }
        });

        window.hls.loadSource(url);
        window.hls.attachMedia(v);

        window.hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (!isNaN(savedTime) && savedTime > 0) v.currentTime = savedTime;
            hideBuffering();
            buildQualityOpts();
            updateQualityLabel();
            onReady();
            startDurationPoll();
            if (shouldPlayAfterSwitch !== false) {
                v.play().catch(function () {
                    v.muted = true;
                    v.play().catch(function () { });
                });
            }
        });

        window.hls.on(Hls.Events.LEVEL_SWITCHED, function () {
            updateQualityLabel();
        });

        window.hls.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                        window.hls.networkErrors = (window.hls.networkErrors || 0) + 1;
                        if (window.hls.networkErrors > 5) {
                            showPlaybackError('Network stream unavailable');
                        } else {
                            window.hls.startLoad();
                        }
                    } else {
                        window.hls.startLoad();
                    }
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    window.hls.recoverMediaError();
                } else {
                    showPlaybackError(data.details);
                }
            }
        });
    }

    function initDash(url, savedTime, shouldPlayAfterSwitch, isInitialLoad) {
        if (window.dashPlayer) {
            try { window.dashPlayer.destroy(); } catch (ex) { }
            window.dashPlayer = null;
        }
        v.pause();
        v.removeAttribute('src');
        v.load();

        var player = dashjs.MediaPlayer().create();
        window.dashPlayer = player;

        player.extend('RequestModifier', function () {
            return {
                modifyRequestHeader: function (xhr, req) {
                    if (req.url && req.url.startsWith(window.baseURL)) {
                        var token = window.store && window.store.sessionToken;
                        if (token) xhr.setRequestHeader('X-Session-Token', token);
                    }
                    return xhr;
                },
                modifyRequestURL: function (url) { return url; }
            };
        }, true);

        player.initialize(v, url, false);

        player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, function () {
            if (!isNaN(savedTime) && savedTime > 0) v.currentTime = savedTime;
            hideBuffering();
            buildQualityOpts();
            updateQualityLabel();
            if (isInitialLoad) {
                onReady();
                startDurationPoll();
            }
            if (shouldPlayAfterSwitch !== false) {
                v.play().catch(function () {
                    v.muted = true;
                    v.play().catch(function () { });
                });
            }
        });

        player.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, function () {
            updateQualityLabel();
        });

        player.on(dashjs.MediaPlayer.events.ERROR, function (e) {
            showPlaybackError((e && e.error && e.error.message) || 'DASH playback error');
        });
    }

    function initSegmentsView() {
        var cont = document.getElementById('seg-content');
        if (!cont) return;
        if (!id) {
            cont.innerHTML = '';
            return;
        }
        if (_segmentsLoaded) { renderSegmentsView(); return; }
        cont.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px 0;"><svg width="32" height="32" viewBox="0 0 52 52" style="animation:_vyla_spin 0.9s linear infinite"><circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3.5" stroke-dasharray="100" stroke-dashoffset="70"/></svg></div>';

        var apiUrl = 'https://api.theintrodb.org/v3/media?tmdb_id=' + id;
        if (s) apiUrl += '&season=' + s + '&episode=' + (e || '1');

        fetch(apiUrl)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                _segmentsData = d;
                _segmentsLoaded = true;
                renderSegmentsView();
                setupSkipButtons();
            })
            .catch(function (err) {
                _segmentsLoaded = true;
                _segmentsData = null;
                renderSegmentsView();
            });
    }

    function getActiveSourceName() {
        if (window._activeSourceLabel) return window._activeSourceLabel;
        var source = Array.isArray(sources) && sources[currentSourceIndex] ? sources[currentSourceIndex] : null;
        return source ? (source.label || source.source || 'Source') : 'Source';
    }

    function playStream(streamItem, parentSource, parentIdx) {
        if (!streamItem || !streamItem.proxiedUrl) return;
        currentSourceIndex = parentIdx;
        window._activeSourceLabel = (parentSource.label || parentSource.key) + (streamItem.quality ? ' (' + streamItem.quality + ')' : '');
        switchSource(streamItem.proxiedUrl, true);
        if (typeof buildSourceList === 'function') buildSourceList();
    }

    buildSourceList = function () {
        var sourcesOpts = document.getElementById('sources-opts');
        if (!sourcesOpts) return;
        sourcesOpts.innerHTML = '';

        var activeName = getActiveSourceName();
        activeName = activeName.charAt(0).toUpperCase() + activeName.slice(1);
        var lblSource = document.getElementById('lbl-source');
        if (lblSource) lblSource.textContent = activeName;

        sources.forEach(function (source, i) {
            var isActive = i === currentSourceIndex;
            var rawName = source.label || source.source || 'Source ' + (i + 1);
            var name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
            var streamsToDisplay = (source.allUrls && source.allUrls.length) ? source.allUrls : [{ quality: 'Auto', proxiedUrl: source.url, url: source.rawUrl || source.url }];
            var hasMultiple = streamsToDisplay.length > 1;

            var group = document.createElement('div');
            group.className = 'src-group-item';

            var item = document.createElement('div');
            item.className = 'src-header-row';
            item.innerHTML =
                '<span class="src-title-label">' + name + '</span>' +
                '<div class="src-meta-wrap">' +
                (hasMultiple ? '<span class="src-count-badge">' + streamsToDisplay.length + ' streams</span><i class="fa-solid fa-chevron-down src-expand-arrow"></i>' : '') +
                (isActive ? '<span class="src-active-badge"><i class="fa-solid fa-check"></i></span>' : '') +
                '</div>';

            if (!hasMultiple) {
                item.addEventListener('click', function () {
                    window.haptic(6);
                    playStream(streamsToDisplay[0], source, i);
                });
                group.appendChild(item);
            } else {
                var streamList = document.createElement('div');
                streamList.className = 'src-streams-dropdown';
                streamList.style.display = isActive ? 'flex' : 'none';

                streamsToDisplay.forEach(function (st, sIdx) {
                    var streamRow = document.createElement('div');
                    streamRow.className = 'src-stream-subitem';
                    var qLabel = st.quality || ('Stream ' + (sIdx + 1));
                    streamRow.innerHTML =
                        '<span class="src-stream-name">' + qLabel + '</span>' +
                        '<span class="src-stream-status"><i class="fa-solid fa-circle-play"></i></span>';

                    streamRow.addEventListener('click', function (e) {
                        e.stopPropagation();
                        window.haptic(8);
                        playStream(st, source, i);
                    });

                    streamList.appendChild(streamRow);
                });

                item.addEventListener('click', function () {
                    window.haptic(6);
                    var isExpanded = streamList.style.display === 'flex';
                    document.querySelectorAll('.src-streams-dropdown').forEach(function (el) { el.style.display = 'none'; });
                    streamList.style.display = isExpanded ? 'none' : 'flex';
                });

                group.appendChild(item);
                group.appendChild(streamList);
            }

            sourcesOpts.appendChild(group);
        });
    };

    function showSrcDetail(source, idx) {
        currentSourceIndex = idx;
        if (source.url) {
            switchSource(source.url, true);
        }
    }

    function fetchSources() {
        if (sourcesLoaded && typeof buildSourceList === 'function') buildSourceList();
    }

    fetchSources();
    if (sourcesLoaded && typeof buildSourceList === 'function') buildSourceList();

    function bindControl(el, key, isColor) {
        if (!el) return;
        var eventType = isColor ? 'input' : 'change';
        el.addEventListener(eventType, function (e) {
            e.stopPropagation();
            subState[key] = this.value;
            applySubStyles();
            if (!isColor) saveSubSettings();
        });
        if (isColor) {
            el.addEventListener('change', function (e) {
                e.stopPropagation();
                saveSubSettings();
                window.haptic(6);
            });
        } else {
            el.addEventListener('change', function () {
                window.haptic(6);
            });
        }
    }

    bindControl(subFontSelect, 'font', false);
    bindControl(subSizeSelect, 'size', false);
    bindControl(subColorInput, 'color', true);
    bindControl(subBgColorInput, 'bgColor', true);
    bindControl(subBgOpacitySelect, 'bgOpacity', false);
    bindControl(subPosSelect, 'pos', false);
    bindControl(subEdgeSelect, 'edge', false);

    if (btnPip) {
        var pipSupported = 'pictureInPictureEnabled' in document ||
            'webkitPictureInPictureEnabled' in document ||
            'pictureInPictureElement' in document;
        if (!pipSupported) {
            btnPip.style.display = 'none';
        } else {
            btnPip.addEventListener('click', function (e) {
                e.stopPropagation();
                window.haptic(10);
                var pipElement = document.pictureInPictureElement || document.webkitPictureInPictureElement;
                if (pipElement) {
                    if (document.exitPictureInPicture) document.exitPictureInPicture();
                    else if (document.webkitExitPictureInPicture) document.webkitExitPictureInPicture();
                } else {
                    if (v.requestPictureInPicture) v.requestPictureInPicture();
                    else if (v.webkitRequestPictureInPicture) v.webkitRequestPictureInPicture();
                }
            });
        }
    }

    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', function (e) {
            e.stopPropagation();
            window.haptic(10);
            if (window.isIOS() && typeof v.webkitEnterFullscreen === 'function') {
                if (v.webkitDisplayingFullscreen) {
                    v.webkitExitFullscreen();
                } else {
                    v.webkitEnterFullscreen();
                }
                return;
            }
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement ||
                document.mozFullScreenElement || document.msFullscreenElement;
            if (fsEl) {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
                else if (document.msExitFullscreen) document.msExitFullscreen();
            } else {
                var player = document.getElementById('player');
                if (player.requestFullscreen) player.requestFullscreen();
                else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
                else if (player.mozRequestFullScreen) player.mozRequestFullScreen();
                else if (player.msRequestFullscreen) player.msRequestFullscreen();
            }
        });
    }

    wrap.addEventListener('mouseenter', function () { trackEl.classList.add('hover'); });
    wrap.addEventListener('mouseleave', function () {
        if (!dragging) trackEl.classList.remove('hover');
        tooltip.classList.remove('show');
        lastTooltipPct = -1;
    });
    wrap.addEventListener('mousemove', function (e) { e.stopPropagation(); hoverTooltip(e.clientX); });
    wrap.addEventListener('mousedown', function (e) {
        e.stopPropagation();
        dragging = true;
        trackEl.classList.add('drag');
        seekX(e.clientX);
        showUI(true);
        window.haptic(6);
    });
    function showSeekTooltip(clientX) {
        if (!v.duration) return;
        var r = wrap.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        var thumbHalf = 8;
        var tipLeft = Math.max(thumbHalf, Math.min(r.width - thumbHalf, pct * r.width));
        tooltip.style.left = tipLeft + 'px';
        tooltipTime.textContent = window.fmt(pct * v.duration);
        tooltip.classList.add('show');
    }

    wrap.addEventListener('touchstart', function (e) {
        e.stopPropagation();
        clearTimeout(_speedBoostTimer);
        dragging = true;
        trackEl.classList.add('drag');
        seekX(e.touches[0].clientX);
        showUI(true);
        window.haptic();
        showSeekTooltip(e.touches[0].clientX);
    }, { passive: true });

    wrap.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        e.preventDefault();
        seekX(e.touches[0].clientX);
        showSeekTooltip(e.touches[0].clientX);
    }, { passive: false });

    wrap.addEventListener('touchend', function (e) {
        if (!dragging) return;
        var x = e.changedTouches ? e.changedTouches[0].clientX : undefined;
        if (x !== undefined) { seekX(x); commitSeek(x); }
        dragging = false;
        trackEl.classList.remove('drag', 'hover');
        tooltip.classList.remove('show');
        if (!v.paused) showUI();
    });

    var lastDragX = 0;
    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        trackEl.classList.remove('drag', 'hover');
        var x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
        commitSeek(x !== undefined ? x : lastDragX);
        tooltip.classList.remove('show');
        if (!v.paused) showUI();
    }
    document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        lastDragX = e.clientX;
        seekX(e.clientX);
        hoverTooltip(e.clientX);
    });
    document.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        lastDragX = e.touches[0].clientX;
        seekX(e.touches[0].clientX);
        showSeekTooltip(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', function (e) {
        if (dragging) endDrag(e);
    });

    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (document.body.classList.contains('tv-nav-mode')) return;
            if (e.key === 'ArrowLeft') { doSkip('left', 1); showUI(); }
            if (e.key === 'ArrowRight') { doSkip('right', 1); showUI(); }
            return;
        }
        if (e.key === ' ' || e.key === 'k' || e.key === 'K') { e.preventDefault(); window.haptic(10); v.paused ? v.play() : v.pause(); }
        if (e.key === 'f' || e.key === 'F') {
            if (window.isIOS() && typeof v.webkitEnterFullscreen === 'function') {
                if (v.webkitDisplayingFullscreen) {
                    v.webkitExitFullscreen();
                } else {
                    v.webkitEnterFullscreen();
                }
                return;
            }
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement ||
                document.mozFullScreenElement || document.msFullscreenElement;
            if (fsEl) {
                if (document.exitFullscreen) document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
                else if (document.msExitFullscreen) document.msExitFullscreen();
            } else {
                var player = document.getElementById('player');
                if (player.requestFullscreen) player.requestFullscreen();
                else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
                else if (player.mozRequestFullScreen) player.mozRequestFullScreen();
                else if (player.msRequestFullscreen) player.msRequestFullscreen();
            }
        }
    });

    (function () {
        var kbHint = null;
        var kbHintTimer = null;
        var shortcuts = [
            { key: 'Space / K', desc: 'Play / Pause' },
            { key: '← →', desc: 'Skip 10 seconds' },
            { key: 'F', desc: 'Fullscreen' }
        ];

        document.addEventListener('keydown', function (e) {
            if (e.key === '?') {
                if (!kbHint) {
                    kbHint = document.createElement('div');
                    shortcuts.forEach(function (s) {
                        var row = document.createElement('div');
                        row.innerHTML = '<span style="background:rgba(255,255,255,0.12);border-radius:6px;padding:3px 10px;font-size:12px;font-weight:700;color:var(--white);letter-spacing:0.04em;min-width:36px;text-align:center;font-family:var(--font);">' + s.key + '</span><span style="font-size:13px;color:rgba(255,255,255,0.75);font-family:var(--font);font-weight:500;">' + s.desc + '</span>';
                        kbHint.appendChild(row);
                    });
                    document.body.appendChild(kbHint);
                }
                kbHint.style.opacity = '1';
                clearTimeout(kbHintTimer);
                kbHintTimer = setTimeout(function () {
                    kbHint.style.opacity = '0';
                }, 3000);
            }
        });
    })();

    var _cursorMoveTimer = null;
    document.getElementById('player').addEventListener('mousemove', function () {
        var pl = document.getElementById('player');
        if (pl) {
            pl.style.setProperty('cursor', 'default', 'important');
            clearTimeout(_cursorMoveTimer);
            _cursorMoveTimer = setTimeout(function () {
                pl.style.removeProperty('cursor');
            }, 3000);
        }

        if (!v.paused) {
            clearTimeout(hideTimer);
            if (shown) {
                if (!settingsOpen) hideTimer = setTimeout(hideUI, 3200);
            } else {
                showUI();
            }
        } else {
            showUI();
        }
    });

    v.addEventListener('timeupdate', setProg);

    var timestampRestored = false;
    function restoreTimestamp() {
        if (timestampRestored) return;

        var videoKey = (s ? videoId + '_s' + s + '_e' + (e || '1') : videoId);
        var savedTime = getTimestamp(videoKey);

        if (savedTime > 5 && v.duration > savedTime + 5) {
            v.currentTime = savedTime;
            timestampRestored = true;
        }
    }

    v.addEventListener('loadedmetadata', function () {
        restoreTimestamp();
    });

    v.addEventListener('loadeddata', function () {
        restoreTimestamp();
    });

    v.addEventListener('canplay', function () {
        restoreTimestamp();
    });

    v.addEventListener('durationchange', function () {
        if (v.duration) {
            clearTimeout(retryTimer);
            retryCount = maxRetries;
            hideBuffering();
            restoreTimestamp();
        }
    });

    setTimeout(function () {
        restoreTimestamp();
    }, 2000);

    var lastSaveTime = 0;
    v.addEventListener('timeupdate', function () {
        var now = Date.now();
        if (now - lastSaveTime > 5000) {
            var videoKey = (s ? videoId + '_s' + s + '_e' + (e || '1') : videoId);
            saveTimestamp(videoKey, v.currentTime);
            lastSaveTime = now;
        }
    });

    var nextEpBtn = s ? document.getElementById('next-ep-btn') : null;
    var nextEpInner = s ? document.getElementById('next-ep-inner') : null;
    var nextEpLabel = s ? document.getElementById('next-ep-label') : null;
    var nextEpHref = null;
    var nextEpReady = false;

    function checkAndShowNextEpBtn() {
        if (!nextEpBtn || !nextEpReady || !v.duration || v.duration < 60) return;
        var remaining = v.duration - v.currentTime;
        nextEpBtn.style.display = '';
        if (remaining <= 300) {
            nextEpBtn.classList.add('show');
        } else {
            nextEpBtn.classList.remove('show');
        }
    }
    window._checkAndShowNextEpBtn = checkAndShowNextEpBtn;
    window._getNextEpBtn = function () { return nextEpBtn; };
    window._isNextEpReady = function () { return nextEpReady; };

    if (s && nextEpBtn && nextEpInner && nextEpLabel) {
        nextEpBtn.style.display = 'none';

        var nextE = parseInt(e || '1') + 1;
        var nextS = parseInt(s);

        fetch(window.baseURL + '/api/tv?id=' + id + '&season=' + nextS + '&episode=' + nextE, {
            headers: {
                'X-Session-Token': window.store && window.store.sessionToken ? window.store.sessionToken : ''
            }
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var t = d.meta ? (d.meta.title || d.meta.name || 'Unknown') : 'Unknown';
                nextEpLabel.textContent = 'S' + nextS + ' E' + nextE + ' \u00b7 ' + t;
                nextEpHref = location.pathname + '?id=' + id + '&season=' + nextS + '&episode=' + nextE + '&ap=1';
                nextEpReady = true;
                checkAndShowNextEpBtn();
            })
            .catch(function () { });

        nextEpInner.addEventListener('click', function () {
            if (nextEpHref) location.href = nextEpHref;
        });

        v.addEventListener('timeupdate', checkAndShowNextEpBtn);
        v.addEventListener('durationchange', checkAndShowNextEpBtn);

        v.addEventListener('ended', function () {
            var videoKey = (s ? id + '_s' + s + '_e' + (e || '1') : id);
            clearTimestamp(videoKey);

            var _nextE = parseInt(e || '1') + 1;
            var _nextS = parseInt(s);

            nextEpBtn.style.display = 'none';

            var reqHeaders = {};
            if (window.store && window.store.sessionToken) reqHeaders['X-Session-Token'] = window.store.sessionToken;

            fetch(window.baseURL + '/api/tv?id=' + id + '&season=' + _nextS + '&episode=' + _nextE, { headers: reqHeaders })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.error || !d.url) {
                        fetch(window.baseURL + '/api/tv?id=' + id + '&season=' + (_nextS + 1) + '&episode=1', { headers: reqHeaders })
                            .then(function (r) { return r.json(); })
                            .then(function (d2) {
                                if (d2.error || !d2.url) return;
                                var toast = document.getElementById('now-playing-toast');
                                if (!toast) return;
                                var title = d2.meta ? (d2.meta.title || d2.meta.name || 'Unknown') : 'Unknown';
                                title += ' \u00b7 S' + (_nextS + 1) + 'E1';
                                toast.innerHTML = '<div class="np-glow"></div><div class="np-inner"><span class="np-label">Up Next</span><span class="np-title">\u201c' + title + '\u201d</span></div>';
                                toast.className = '';
                                setTimeout(function () {
                                    toast.classList.add('enter');
                                    setTimeout(function () {
                                        toast.classList.remove('enter');
                                        toast.classList.add('exit');
                                        setTimeout(function () {
                                            location.href = location.pathname + '?id=' + id + '&season=' + (_nextS + 1) + '&episode=1&ap=1';
                                        }, 800);
                                    }, 3800);
                                }, 400);
                            })
                            .catch(function () { });
                        return;
                    }
                    var toast = document.getElementById('now-playing-toast');
                    if (!toast) return;
                    var title = d.meta ? (d.meta.title || d.meta.name || 'Unknown') : 'Unknown';
                    title += ' \u00b7 S' + _nextS + 'E' + _nextE;
                    toast.innerHTML = '<div class="np-glow"></div><div class="np-inner"><span class="np-label">Up Next</span><span class="np-title">\u201c' + title + '\u201d</span></div>';
                    toast.className = '';
                    setTimeout(function () {
                        toast.classList.add('enter');
                        setTimeout(function () {
                            toast.classList.remove('enter');
                            toast.classList.add('exit');
                            setTimeout(function () {
                                location.href = location.pathname + '?id=' + id + '&season=' + _nextS + '&episode=' + _nextE + '&ap=1';
                            }, 800);
                        }, 3800);
                    }, 400);
                })
                .catch(function () { });
        });
    }

    window._checkAndShowNextEpBtn = checkAndShowNextEpBtn;
    window._getNextEpBtn = function () { return nextEpBtn; };
    window._isNextEpReady = function () { return nextEpReady; };

    if (s) {
        nextEpBtn.style.display = 'none';

        var nextE = parseInt(e || '1') + 1;
        var nextS = parseInt(s);

        fetch(window.baseURL + '/api/tv?id=' + id + '&season=' + _nextS + '&episode=' + _nextE, {
            headers: {
                'X-Session-Token': window.store && window.store.sessionToken ? window.store.sessionToken : ''
            }
        })

            .then(function (r) { return r.json(); })
            .then(function (d) {
                var t = d.meta ? (d.meta.title || d.meta.name || 'Unknown') : 'Unknown';
                nextEpLabel.textContent = 'S' + nextS + ' E' + nextE + ' \u00b7 ' + t;
                nextEpHref = location.pathname + '?id=' + id + '&season=' + nextS + '&episode=' + nextE + '&ap=1';
                nextEpReady = true;
                checkAndShowNextEpBtn();
            })
            .catch(function () { });

        nextEpInner.addEventListener('click', function () {
            if (nextEpHref) location.href = nextEpHref;
        });

        v.addEventListener('timeupdate', checkAndShowNextEpBtn);
        v.addEventListener('durationchange', checkAndShowNextEpBtn);

        v.addEventListener('ended', function () {
            var videoKey = (s ? id + '_s' + s + '_e' + (e || '1') : id);
            clearTimestamp(videoKey);

            var _nextE = parseInt(e || '1') + 1;
            var _nextS = parseInt(s);

            nextEpBtn.style.display = 'none';

            var reqHeaders = {};
            if (window.store && window.store.sessionToken) reqHeaders['X-Session-Token'] = window.store.sessionToken;
            fetch(endpoint, { headers: reqHeaders })

            fetch(window.baseURL + '/api/tv?id=' + id + '&season=' + _nextS + '&episode=' + _nextE, { headers: reqHeaders })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.error || !d.url) {
                        fetch(window.baseURL + '/api/tv?id=' + id + '&season=' + (_nextS + 1) + '&episode=1', { headers: reqHeaders })
                            .then(function (r) { return r.json(); })
                            .then(function (d2) {
                                if (d2.error || !d2.url) return;
                                var toast = document.getElementById('now-playing-toast');
                                var title = d2.meta ? (d2.meta.title || d2.meta.name || 'Unknown') : 'Unknown';
                                title += ' \u00b7 S' + (_nextS + 1) + 'E1';
                                toast.innerHTML = '<div class="np-glow"></div><div class="np-inner"><span class="np-label">Up Next</span><span class="np-title">\u201c' + title + '\u201d</span></div>';
                                toast.className = '';
                                setTimeout(function () {
                                    toast.classList.add('enter');
                                    setTimeout(function () {
                                        toast.classList.remove('enter');
                                        toast.classList.add('exit');
                                        setTimeout(function () {
                                            location.href = location.pathname + '?id=' + id + '&season=' + (_nextS + 1) + '&episode=1&ap=1';
                                        }, 800);
                                    }, 3800);
                                }, 400);
                            })
                            .catch(function () { });
                        return;
                    }
                    var toast = document.getElementById('now-playing-toast');
                    var title = d.meta ? (d.meta.title || d.meta.name || 'Unknown') : 'Unknown';
                    title += ' \u00b7 S' + _nextS + 'E' + _nextE;
                    toast.innerHTML = '<div class="np-glow"></div><div class="np-inner"><span class="np-label">Up Next</span><span class="np-title">\u201c' + title + '\u201d</span></div>';
                    toast.className = '';
                    setTimeout(function () {
                        toast.classList.add('enter');
                        setTimeout(function () {
                            toast.classList.remove('enter');
                            toast.classList.add('exit');
                            setTimeout(function () {
                                location.href = location.pathname + '?id=' + id + '&season=' + _nextS + '&episode=' + _nextE + '&ap=1';
                            }, 800);
                        }, 3800);
                    }, 400);
                })
                .catch(function () { });
        });

    }

    var playerRoot = document.getElementById('player');
    if (playerRoot && window.getComputedStyle(playerRoot).position === 'static') {
        playerRoot.style.position = 'relative';
    }
    v.style.pointerEvents = 'none';

    var existingOverlay = document.getElementById('click-overlay');
    if (existingOverlay) existingOverlay.remove();

    var clickOverlay = document.createElement('div');
    clickOverlay.id = 'click-overlay';
    clickOverlay.style.cssText = 'position:fixed;inset:0;z-index:18;';
    v.parentElement.insertBefore(clickOverlay, v.nextSibling);

    var _clickOverlayTouchHandled = false;
    function isCenterControlEvent(ev) {
        if (!ev) return false;
        var path = [];
        if (typeof ev.composedPath === 'function') {
            path = ev.composedPath();
        } else if (ev.target) {
            path = [ev.target];
        }
        return path.some(function (node) {
            return !!(node && (node === centerFlash || node === ci || (node.closest && node.closest && node.closest('#center-flash'))));
        });
    }

    function handleClickOverlayTap(ev) {
        if (settingsOpen || dragging) return;
        var isTouch = window.matchMedia('(pointer: coarse)').matches;
        if (isTouch && shown && isCenterControlEvent(ev)) {
            window.haptic();
            flashCenter();
            var _v = document.getElementById('v') || v;
            try { _v.playbackRate = savedSpeed; } catch (ex) { }
            _v.paused ? _v.play() : _v.pause();
            return;
        }
        if (isTouch) {
            if (!shown) {
                showUI(true);
                _suppressTogglePlayUntil = Date.now() + 600;
            } else {
                hideUI();
                _suppressShowUntil = Date.now() + 600;
            }
            return;
        }
        if (!shown) {
            showUI(true);
            _suppressTogglePlayUntil = Date.now() + 600;
            return;
        }
        window.haptic();
        flashCenter();
        var _v = document.getElementById('v') || v;
        if (Date.now() < _suppressTogglePlayUntil) return;
        _v.paused ? _v.play() : _v.pause();
    }

    clickOverlay.addEventListener('touchend', function (e) {
        _clickOverlayTouchHandled = true;
        handleClickOverlayTap(e);
    }, { passive: true });

    clickOverlay.addEventListener('click', function (e) {
        if (_clickOverlayTouchHandled) {
            _clickOverlayTouchHandled = false;
            return;
        }
        if (settingsOpen || dragging) return;
        handleClickOverlayTap(e);
    });

    document.getElementById('player').addEventListener('click', function (e) {
        if (settingsOpen || dragging) return;
        var _co = document.getElementById('click-overlay');
        if (_co && (_co === e.target || _co.contains(e.target))) return;
        if (controlsWrapper.contains(e.target)) return;
        if (settingsPanel && settingsPanel.contains(e.target)) return;
        if (btnSettings && btnSettings.contains(e.target)) return;
        if (sourceBtnWrap && sourceBtnWrap.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.cf-skip-btn')) return;
        if (!shown) { showUI(true); _suppressTogglePlayUntil = Date.now() + 600; return; }
        hideUI();
    });

    var isPressing = false;
    var _boostDidActivate = false;
    var _wasPausedBeforeBoost = false;
    var originalPlaybackSpeed = 1;
    var playerEl = document.getElementById('player');

    var _speedBoostTimer = null;
    var _speedBoostRaf = null;
    var _suppressBoostUntil = 0;

    function startSpeedBoost() {
        if (Date.now() < _suppressBoostUntil) return;
        if (isPressing) return;
        isPressing = true;
        _boostDidActivate = true;
        _wasPausedBeforeBoost = v.paused;
        originalPlaybackSpeed = savedSpeed;
        if (v.paused) {
            var _boostPlayPromise = v.play();
            if (_boostPlayPromise !== undefined) {
                _boostPlayPromise.then(function () {
                    if (isPressing) v.playbackRate = 2;
                    else v.pause();
                }).catch(function () { });
            }
        }
        v.playbackRate = 2;
        playerEl.style.cursor = 'grabbing';
        var badge = document.getElementById('speed-boost-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'speed-boost-badge';
            badge.style.cssText = 'position:absolute;top:18px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(0,0,0,0.65);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:var(--white);font-family:var(--font);font-size:13px;font-weight:700;padding:6px 16px;border-radius:100px;display:flex;align-items:center;gap:7px;letter-spacing:0.03em;opacity:0;transition:opacity 0.18s ease;pointer-events:none;';
            badge.innerHTML = '<i class="fa-solid fa-forward" style="font-size:12px;"></i> 2x speed';
            document.getElementById('player').appendChild(badge);
        }
        _speedBoostRaf = requestAnimationFrame(function () { _speedBoostRaf = null; badge.style.opacity = '1'; });
    }

    function endSpeedBoost() {
        clearTimeout(_speedBoostTimer);
        _speedBoostTimer = null;
        if (_speedBoostRaf) {
            cancelAnimationFrame(_speedBoostRaf);
            _speedBoostRaf = null;
        }
        isPressing = false;
        v.playbackRate = originalPlaybackSpeed;
        _boostDidActivate = false;
        if (_wasPausedBeforeBoost) {
            var pausePromise = v.play();
            if (pausePromise !== undefined) {
                pausePromise.then(function () { v.pause(); }).catch(function () { });
            } else {
                v.pause();
            }
        }
        playerEl.style.cursor = '';
        var badge = document.getElementById('speed-boost-badge');
        if (badge) badge.style.opacity = '0';
    }

    playerEl.addEventListener('mousedown', function (e) {
        if (controlsWrapper.contains(e.target)) return;
        if (settingsPanel && settingsPanel.contains(e.target)) return;
        if (btnSettings.contains(e.target)) return;
        if (e.button !== 0) return;
        _boostDidActivate = false;
        if (speedBoostEnabled) _speedBoostTimer = setTimeout(function () { startSpeedBoost(); }, 600);
    });

    playerEl.addEventListener('mouseup', function (e) {
        endSpeedBoost();
    });
    playerEl.addEventListener('mouseleave', endSpeedBoost);

    playerEl.addEventListener('click', function (e) {
        if (_boostDidActivate) {
            _boostDidActivate = false;
            e.stopImmediatePropagation();
            return;
        }
    }, true);

    playerEl.addEventListener('touchstart', function (e) {
        if (controlsWrapper.contains(e.target)) return;
        if (settingsPanel && settingsPanel.contains(e.target)) return;
        if (btnSettings.contains(e.target)) return;
        if (wrap.contains(e.target)) return;
        _boostDidActivate = false;
        if (Date.now() >= _suppressBoostUntil && speedBoostEnabled) _speedBoostTimer = setTimeout(function () {
            if (!dragging) startSpeedBoost();
        }, 600);
    }, { passive: true });

    playerEl.addEventListener('touchend', function (e) {
        endSpeedBoost();
    });

    v.addEventListener('play', function () {
        try {
            if (Math.abs(v.playbackRate - savedSpeed) > 0.01 && !isPressing && !_boostDidActivate) {
                v.playbackRate = savedSpeed;
            }
        } catch (ex) { }
    });

    (function () {
        var openBtn = document.getElementById('sub-customize-open-btn');
        var backBtn = document.getElementById('sub-custom-back-btn');
        var langView = document.getElementById('sub-lang-group-view');
        var customView = document.getElementById('sub-custom-view');

        var subViewTitle = document.getElementById('sub-view-title');
        var subCustomizeBtn = document.getElementById('sub-customize-open-btn');
        var subMainBackBtn = document.getElementById('sub-main-back-btn');
        var advancedBtn = document.getElementById('sub-advanced-btn');
        var advancedContent = document.getElementById('sub-advanced-content');

        var subPresets = {
            default: {
                font: 'sans',
                size: 'medium',
                color: '#ffffff',
                bgColor: '#000000',
                bgOpacity: 0.75,
                textShadow: 'shadow',
                pos: 'mid',
                weight: '500'
            },
            clean: {
                font: 'sans',
                size: 'medium',
                color: '#ffffff',
                bgColor: 'transparent',
                bgOpacity: 0,
                textShadow: 'shadow',
                pos: 'mid',
                weight: '500'
            },
            'high-contrast': {
                font: 'sans',
                size: 'medium',
                color: '#ffffff',
                bgColor: '#000000',
                bgOpacity: 1,
                textShadow: 'none',
                pos: 'mid',
                weight: '700'
            },
            cinema: {
                font: 'serif',
                size: 'medium',
                color: '#ffff00',
                bgColor: '#000000',
                bgOpacity: 0.9,
                textShadow: 'both',
                pos: 'mid',
                weight: '500'
            }
        };

        function applySubPreset(presetName) {
            var preset = subPresets[presetName];
            if (!preset) return;

            Object.keys(preset).forEach(function (key) {
                subState[key] = preset[key];
            });

            applySubStyles();
            saveSubSettings();
            updateSimpleControls();
            updateAdvancedControls();
        }

        function updateSimpleControls() {
            document.querySelectorAll('.sub-size-btn').forEach(function (btn) {
                btn.classList.toggle('active', btn.dataset.size === subState.size);
            });

            document.querySelectorAll('.sub-pos-btn').forEach(function (btn) {
                btn.classList.toggle('active', btn.dataset.pos === subState.pos);
            });

            var bgType = 'none';
            if (subState.bgOpacity > 0.8) bgType = 'dark';
            else if (subState.bgOpacity > 0.3) bgType = 'light';

            document.querySelectorAll('.sub-bg-btn').forEach(function (btn) {
                btn.classList.toggle('active', btn.dataset.bg === bgType);
            });

            var currentPreset = 'default';
            Object.keys(subPresets).forEach(function (presetName) {
                var preset = subPresets[presetName];
                var matches = true;
                Object.keys(preset).forEach(function (key) {
                    if (subState[key] !== preset[key]) matches = false;
                });
                if (matches) currentPreset = presetName;
            });

            document.querySelectorAll('.sub-preset-btn').forEach(function (btn) {
                btn.classList.toggle('active', btn.dataset.preset === currentPreset);
            });
        }

        function updateAdvancedControls() {
            var subBgOpacityRange = document.getElementById('sub-bg-opacity-range');
            var subBgOpacityVal = document.getElementById('sub-bg-opacity-val');
            if (subBgOpacityRange && subBgOpacityVal) {
                subBgOpacityRange.value = parseFloat(subState.bgOpacity) * 100;
                subBgOpacityVal.textContent = Math.round(parseFloat(subState.bgOpacity) * 100) + '%';
            }

            var subTextSizeRange = document.getElementById('sub-text-size-range');
            var subTextSizeVal = document.getElementById('sub-text-size-val');
            if (subTextSizeRange && subTextSizeVal) {
                subTextSizeRange.value = 100;
                subTextSizeVal.textContent = '100%';
            }

            var subTextStyleSelect = document.getElementById('sub-text-style-select');
            if (subTextStyleSelect) {
                subTextStyleSelect.value = subState.font;
            }

            var subBoldToggle = document.getElementById('sub-bold-toggle');
            if (subBoldToggle) {
                subBoldToggle.classList.toggle('on', subState.weight === '700');
            }
        }

        document.querySelectorAll('.sub-preset-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var preset = this.dataset.preset;
                applySubPreset(preset);
                window.haptic(6);
            });
        });

        document.querySelectorAll('.sub-size-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                subState.size = this.dataset.size;
                applySubStyles();
                saveSubSettings();
                updateSimpleControls();
                window.haptic(6);
            });
        });

        document.querySelectorAll('.sub-pos-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                subState.pos = this.dataset.pos;
                applySubStyles();
                saveSubSettings();
                updateSimpleControls();
                window.haptic(6);
            });
        });

        document.querySelectorAll('.sub-bg-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var bgType = this.dataset.bg;
                if (bgType === 'none') {
                    subState.bgOpacity = 0;
                } else if (bgType === 'light') {
                    subState.bgOpacity = 0.5;
                } else if (bgType === 'dark') {
                    subState.bgOpacity = 0.9;
                }
                applySubStyles();
                saveSubSettings();
                updateSimpleControls();
                updateAdvancedControls();
                window.haptic(6);
            });
        });

        if (advancedBtn) {
            advancedBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                var _advancedContent = document.getElementById('sub-advanced-content');
                var isExpanded = this.classList.contains('expanded');
                if (isExpanded) {
                    this.classList.remove('expanded');
                    if (_advancedContent) _advancedContent.style.display = 'none';
                } else {
                    this.classList.add('expanded');
                    if (_advancedContent) {
                        _advancedContent.style.display = 'flex';
                        updateAdvancedControls();
                    }
                }
                window.haptic(6);
            });
        }

        if (openBtn) openBtn.addEventListener('click', function () {
            document.getElementById('sub-lang-group-view').style.display = 'none';
            document.getElementById('sub-custom-view').style.display = 'flex';
            updateSimpleControls();
            updateAdvancedControls();
        });

        if (backBtn) backBtn.addEventListener('click', function () {
            document.getElementById('sub-custom-view').style.display = 'none';
            document.getElementById('sub-lang-group-view').style.display = 'flex';
        });

        if (subMainBackBtn) subMainBackBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var _customView = document.getElementById('sub-custom-view');
            var _langView = document.getElementById('sub-lang-group-view');
            var _advancedContent = document.getElementById('sub-advanced-content');
            var _advancedBtn = document.getElementById('sub-advanced-btn');
            if (_customView && (_customView.style.display === 'flex' || _customView.style.display === 'block')) {
                _customView.style.display = 'none';
                if (_langView) _langView.style.display = 'flex';
                if (subViewTitle) subViewTitle.textContent = 'Subtitles';
                if (subCustomizeBtn) subCustomizeBtn.style.display = '';
                if (_advancedBtn) _advancedBtn.classList.remove('expanded');
                if (_advancedContent) _advancedContent.style.display = 'none';
            } else {
                showSettingsView('main');
            }
        });

        document.querySelectorAll('.sub-special-item').forEach(function (el) {
            el.addEventListener('click', function () {
                var subType = el.dataset.sub;
                document.querySelectorAll('.sub-special-item, .sub-lang-item').forEach(function (x) {
                    x.classList.remove('active-sub-item');
                    var check = x.querySelector('.sub-active-check');
                    if (check) check.style.display = 'none';
                });
                el.classList.add('active-sub-item');
                var check = el.querySelector('.sub-active-check');
                if (check) check.style.display = 'block';

                if (subType === 'off') {
                    subState.activeTrack = -1;
                    subState.cues = [];
                    subtitleText.textContent = '';
                    _lastCueText = '';
                    document.getElementById('lbl-subtitle').textContent = 'Off';

                    var mainToggle = document.getElementById('subtitle-toggle');
                    if (mainToggle) {
                        mainToggle.classList.remove('on');
                    }

                    window.haptic(6);
                }
            });
        });

        function updateSliderBg(el) {
            var pct = ((el.value - el.min) / (el.max - el.min) * 100).toFixed(1) + '%';
            el.style.setProperty('--val', pct);
        }

        var subBgOpacityRange = document.getElementById('sub-bg-opacity-range');
        var subBgOpacityVal = document.getElementById('sub-bg-opacity-val');
        if (subBgOpacityRange) {
            updateSliderBg(subBgOpacityRange);
            subBgOpacityRange.value = parseFloat(subState.bgOpacity) * 100;
            subBgOpacityVal.textContent = Math.round(parseFloat(subState.bgOpacity) * 100) + '%';
            subBgOpacityRange.addEventListener('input', function () {
                subState.bgOpacity = (this.value / 100).toFixed(2);
                subBgOpacityVal.textContent = this.value + '%';
                updateSliderBg(this);
                applySubStyles();
                saveSubSettings();
            });
        }

        var subBlurIntensityRange = document.getElementById('sub-blur-intensity-range');
        var subBlurIntensityVal = document.getElementById('sub-blur-intensity-val');
        if (subBlurIntensityRange) {
            updateSliderBg(subBlurIntensityRange);
            subBlurIntensityRange.addEventListener('input', function () {
                subBlurIntensityVal.textContent = this.value + '%';
                updateSliderBg(this);
                var blurPx = (parseFloat(this.value) / 100 * 20).toFixed(1) + 'px';
                subtitleText.style.backdropFilter = 'blur(' + blurPx + ')';
                subtitleText.style.webkitBackdropFilter = 'blur(' + blurPx + ')';
            });
        }

        var subTextSizeRange = document.getElementById('sub-text-size-range');
        var subTextSizeVal = document.getElementById('sub-text-size-val');
        var subSizeBaseMap = { small: 14, medium: 18, large: 23, xlarge: 28, xxlarge: 34 };
        if (subTextSizeRange) {
            updateSliderBg(subTextSizeRange);
            subTextSizeRange.addEventListener('input', function () {
                subTextSizeVal.textContent = this.value + '%';
                updateSliderBg(this);
                var basePx = subSizeBaseMap[subState.size] || 18;
                subtitleText.style.fontSize = (basePx * (parseFloat(this.value) / 100)).toFixed(1) + 'px';
            });
        }

        var dr = document.getElementById('sub-delay-range');
        var dv = document.getElementById('sub-delay-val');
        var subDelaySeconds = 0;
        if (dr) {
            updateSliderBg(dr);
            dr.addEventListener('input', function () {
                subDelaySeconds = parseFloat(this.value);
                dv.textContent = subDelaySeconds.toFixed(1) + 's';
                updateSliderBg(this);
            });
        }
        var hb = document.getElementById('sub-delay-heard');
        var sb = document.getElementById('sub-delay-saw');
        if (hb && dr) hb.addEventListener('click', function () {
            dr.value = Math.max(-10, parseFloat(dr.value) - 0.1);
            subDelaySeconds = parseFloat(dr.value);
            dv.textContent = subDelaySeconds.toFixed(1) + 's';
            updateSliderBg(dr);
        });
        if (sb && dr) sb.addEventListener('click', function () {
            dr.value = Math.min(10, parseFloat(dr.value) + 0.1);
            subDelaySeconds = parseFloat(dr.value);
            dv.textContent = subDelaySeconds.toFixed(1) + 's';
            updateSliderBg(dr);
        });

        var subTextStyleSelect = document.getElementById('sub-text-style-select');
        if (subTextStyleSelect) {
            subTextStyleSelect.value = subState.font;
            subTextStyleSelect.addEventListener('change', function () {
                subState.font = this.value;
                applySubStyles();
                saveSubSettings();
                window.haptic(6);
            });
        }

        var subBoldToggle = document.getElementById('sub-bold-toggle');
        if (subBoldToggle) {
            if (subState.weight === '700') subBoldToggle.classList.add('on');
            subBoldToggle.addEventListener('click', function () {
                this.classList.toggle('on');
                subState.weight = this.classList.contains('on') ? '700' : '500';
                applySubStyles();
                saveSubSettings();
            });
        }

        var subFixCapsToggle = document.getElementById('sub-fix-caps-toggle');
        if (subFixCapsToggle) {
            subFixCapsToggle.addEventListener('click', function () {
                this.classList.toggle('on');
                var on = this.classList.contains('on');
                subtitleText.style.textTransform = on ? 'capitalize' : '';
            });
        }

        var subBgBlurToggle = document.getElementById('sub-bg-blur-toggle');
        if (subBgBlurToggle) {
            subBgBlurToggle.classList.add('on');
            subBgBlurToggle.addEventListener('click', function () {
                this.classList.toggle('on');
                var on = this.classList.contains('on');
                if (!on) {
                    subtitleText.style.backdropFilter = 'none';
                    subtitleText.style.webkitBackdropFilter = 'none';
                } else {
                    var intensity = subBlurIntensityRange ? subBlurIntensityRange.value : 50;
                    var blurPx = (parseFloat(intensity) / 100 * 20).toFixed(1) + 'px';
                    subtitleText.style.backdropFilter = 'blur(' + blurPx + ')';
                    subtitleText.style.webkitBackdropFilter = 'blur(' + blurPx + ')';
                }
            });
        }

        var nativeSubToggle = document.getElementById('native-sub-toggle');
        if (nativeSubToggle) {
            nativeSubToggle.addEventListener('click', function () {
                this.classList.toggle('on');
            });
        }

        var colorSwatches = document.querySelectorAll('.sub-swatch');
        var customColorPicker = document.getElementById('sub-custom-color-picker');
        colorSwatches.forEach(function (sw) {
            sw.addEventListener('click', function () {
                if (sw.dataset.color === 'custom') {
                    customColorPicker.click();
                    return;
                }
                colorSwatches.forEach(function (s) {
                    s.classList.remove('sub-swatch-active');
                    s.innerHTML = s.dataset.color === 'custom' ? '<i class="fa-solid fa-paint-brush" style="color:var(--white-60);font-size:12px;"></i>' : '';
                });
                sw.classList.add('sub-swatch-active');
                sw.innerHTML = '<i class="fa-solid fa-check" style="color:#000;"></i>';
                subState.color = sw.dataset.color;
                applySubStyles();
                saveSubSettings();
            });
        });
        if (customColorPicker) {
            customColorPicker.addEventListener('change', function () {
                colorSwatches.forEach(function (s) {
                    s.classList.remove('sub-swatch-active');
                    s.innerHTML = s.dataset.color === 'custom' ? '<i class="fa-solid fa-paint-brush" style="color:var(--white-60);font-size:12px;"></i>' : '';
                });
                var csw = document.querySelector('.sub-swatch-brush');
                if (csw) {
                    csw.style.background = customColorPicker.value;
                    csw.classList.add('sub-swatch-active');
                }
                subState.color = customColorPicker.value;
                applySubStyles();
                saveSubSettings();
            });
        }

        var bgSwatches = document.querySelectorAll('.sub-bg-swatch');
        var customBgColorPicker = document.getElementById('sub-custom-bg-color-picker');
        bgSwatches.forEach(function (sw) {
            sw.addEventListener('click', function () {
                if (sw.dataset.bgColor === 'custom') {
                    customBgColorPicker.click();
                    return;
                }
                bgSwatches.forEach(function (s) {
                    s.classList.remove('sub-bg-swatch-active');
                    s.innerHTML = s.dataset.bgColor === 'custom' ? '<i class="fa-solid fa-paint-brush" style="color:var(--white-60);font-size:12px;"></i>' : '';
                });
                sw.classList.add('sub-bg-swatch-active');
                sw.innerHTML = '<i class="fa-solid fa-check" style="color:#000;"></i>';
                subState.bgColor = sw.dataset.bgColor;
                applySubStyles();
                saveSubSettings();
            });
        });
        if (customBgColorPicker) {
            customBgColorPicker.addEventListener('change', function () {
                bgSwatches.forEach(function (s) {
                    s.classList.remove('sub-bg-swatch-active');
                    s.innerHTML = s.dataset.bgColor === 'custom' ? '<i class="fa-solid fa-paint-brush" style="color:var(--white-60);font-size:12px;"></i>' : '';
                });
                var csw = document.querySelector('.sub-bg-swatch-brush');
                if (csw) {
                    csw.style.background = customBgColorPicker.value;
                    csw.classList.add('sub-bg-swatch-active');
                }
                subState.bgColor = customBgColorPicker.value;
                applySubStyles();
                saveSubSettings();
            });
        }

        bgSwatches.forEach(function (s) {
            s.classList.remove('sub-bg-swatch-active');
            s.innerHTML = s.dataset.bgColor === 'custom' ? '<i class="fa-solid fa-paint-brush" style="color:var(--white-60);font-size:12px;"></i>' : '';
        });
        if (subState.bgColor === 'transparent') {
            var transparentSwatch = document.querySelector('.sub-bg-swatch[data-bg-color="transparent"]');
            if (transparentSwatch) {
                transparentSwatch.classList.add('sub-bg-swatch-active');
                transparentSwatch.innerHTML = '<i class="fa-solid fa-check" style="color:#000;"></i>';
            }
        } else {
            var currentBgSwatch = document.querySelector('.sub-bg-swatch[data-bg-color="' + subState.bgColor + '"]');
            if (currentBgSwatch) {
                currentBgSwatch.classList.add('sub-bg-swatch-active');
                currentBgSwatch.innerHTML = '<i class="fa-solid fa-check" style="color:#000;"></i>';
            } else {
                var customBgSwatch = document.querySelector('.sub-bg-swatch-brush');
                if (customBgSwatch) {
                    customBgSwatch.style.background = subState.bgColor;
                    customBgSwatch.classList.add('sub-bg-swatch-active');
                }
                if (customBgColorPicker) customBgColorPicker.value = subState.bgColor;
            }
        }

        var subPosSelect = document.getElementById('sub-pos-select');
        if (subPosSelect) {
            subPosSelect.value = subState.pos;
            subPosSelect.addEventListener('change', function () {
                subState.pos = this.value;
                applySubStyles();
                saveSubSettings();
                window.haptic(6);
            });
        }

        var subOverallOpacityRange = document.getElementById('sub-overall-opacity-range');
        var subOverallOpacityVal = document.getElementById('sub-overall-opacity-val');
        if (subOverallOpacityRange) {
            updateSliderBg(subOverallOpacityRange);
            subOverallOpacityRange.value = parseFloat(subState.overallOpacity) * 100;
            subOverallOpacityVal.textContent = Math.round(parseFloat(subState.overallOpacity) * 100) + '%';
            subOverallOpacityRange.addEventListener('input', function () {
                subState.overallOpacity = (this.value / 100).toFixed(2);
                subOverallOpacityVal.textContent = this.value + '%';
                updateSliderBg(this);
                applySubStyles();
                saveSubSettings();
            });
        }

        var subTextShadowSelect = document.getElementById('sub-text-shadow-select');
        if (subTextShadowSelect) {
            subTextShadowSelect.value = subState.textShadow;
            subTextShadowSelect.addEventListener('change', function () {
                subState.textShadow = this.value;
                applySubStyles();
                saveSubSettings();
                window.haptic(6);
            });
        }

        var rb = document.getElementById('sub-custom-reset-btn');
        if (rb) rb.addEventListener('click', function () {
            subState.bgOpacity = '0.75';
            subState.color = '#ffffff';
            subState.bgColor = '#000000';
            subState.overallOpacity = '1';
            subState.textShadow = 'shadow';
            subState.font = 'sans';
            subState.size = 'medium';
            subState.pos = 'mid';
            subState.weight = '500';

            if (subBgOpacityRange) { subBgOpacityRange.value = 75; subBgOpacityVal.textContent = '75%'; updateSliderBg(subBgOpacityRange); }
            if (subBlurIntensityRange) { subBlurIntensityRange.value = 50; subBlurIntensityVal.textContent = '50%'; updateSliderBg(subBlurIntensityRange); }
            if (subTextSizeRange) { subTextSizeRange.value = 100; subTextSizeVal.textContent = '100%'; updateSliderBg(subTextSizeRange); }
            if (dr && dv) { dr.value = 0; subDelaySeconds = 0; dv.textContent = '0.0s'; updateSliderBg(dr); }
            if (subTextStyleSelect) subTextStyleSelect.value = 'sans';
            if (subPosSelect) subPosSelect.value = 'mid';
            if (subTextShadowSelect) subTextShadowSelect.value = 'shadow';
            if (subBoldToggle) subBoldToggle.classList.remove('on');
            if (subFixCapsToggle) subFixCapsToggle.classList.remove('on');
            if (subBgBlurToggle) subBgBlurToggle.classList.add('on');
            if (nativeSubToggle) nativeSubToggle.classList.remove('on');
            if (subOverallOpacityRange) { subOverallOpacityRange.value = 100; subOverallOpacityVal.textContent = '100%'; updateSliderBg(subOverallOpacityRange); }
            subtitleText.style.textTransform = '';
            applySubStyles();
            saveSubSettings();
            window.haptic(6);
        });

        var origOnSubTimeUpdate = v.onSubTimeUpdate;
        var _delayedTimeUpdate = function () {
            if (subState.activeTrack < 0 || !subState.cues.length) {
                if (_lastCueText !== '') { subtitleText.textContent = ''; _lastCueText = ''; }
                return;
            }
            var found = findCue(subState.cues, v.currentTime - subDelaySeconds);
            if (found !== _lastCueText) { subtitleText.textContent = found; _lastCueText = found; }
        };
        v.removeEventListener('timeupdate', onSubTimeUpdate);
        v.addEventListener('timeupdate', _delayedTimeUpdate);
    })();

    document.querySelectorAll('.settings-view').forEach(function (el) {
        el.style.display = 'none';
        el.classList.remove('active');
    });
    if (sourcesLoaded && sources.length) buildSourceList();
}