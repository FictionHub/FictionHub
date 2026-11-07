var ambientCanvas = null;
var ambientCtx = null;
var ambientRenderId = null;
var ambientLastTime = 0;
var ambientEnabled = true;

export function initAmbientGlow() {
    ambientCanvas = document.getElementById('ambient-glow-canvas');
    if (!ambientCanvas) return;
    ambientCtx = ambientCanvas.getContext('2d', { willReadFrequently: false });
    ambientCanvas.width = 64;
    ambientCanvas.height = 36;
}

export function renderAmbientFrame(timestamp) {
    if (!ambientEnabled || !ambientCtx) {
        ambientRenderId = requestAnimationFrame(renderAmbientFrame);
        return;
    }
    var videoEl = document.getElementById('v') || v;
    if (!videoEl || videoEl.readyState < 2 || videoEl.paused) {
        ambientRenderId = requestAnimationFrame(renderAmbientFrame);
        return;
    }
    if (!timestamp || timestamp - ambientLastTime > 66) {
        ambientLastTime = timestamp || 0;
        try {
            ambientCtx.drawImage(videoEl, 0, 0, ambientCanvas.width, ambientCanvas.height);
            ambientCanvas.classList.add('active');
        } catch (e) { }
    }
    ambientRenderId = requestAnimationFrame(renderAmbientFrame);
}

export function startAmbientGlow() {
    if (!ambientCanvas) initAmbientGlow();
    if (ambientRenderId) cancelAnimationFrame(ambientRenderId);
    ambientRenderId = requestAnimationFrame(renderAmbientFrame);
}

export function stopAmbientGlow() {
    if (ambientRenderId) cancelAnimationFrame(ambientRenderId);
    ambientRenderId = null;
    if (ambientCanvas) ambientCanvas.classList.remove('active');
}

export function toggleAmbientGlow(enabled) {
    ambientEnabled = enabled;
    if (window.videoState) window.videoState.ambientGlow = enabled;
    if (enabled) {
        startAmbientGlow();
    } else {
        stopAmbientGlow();
    }
}

window.toggleAmbientGlow = toggleAmbientGlow;