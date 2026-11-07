(function () {
    var video = document.getElementById('v');
    var canvas = document.getElementById('vr-canvas');
    var permissionBtn = document.getElementById('vr-permission-btn');
    var permissionConfirm = document.getElementById('vr-permission-confirm');
    var toggle = document.getElementById('btn-toggle-vr');
    var splitRow = document.getElementById('vr-split-row');
    var projectionRow = document.getElementById('vr-projection-row');
    var splitSelect = document.getElementById('vr-split-select');
    var projectionSelect = document.getElementById('vr-projection-select');

    if (!video || !canvas || !toggle) return;

    var gl = null;
    var glProgram = null;
    var glTexture = null;
    var glBuffers = null;
    var rafId = null;
    var active = false;
    var mode = 'mono';
    var layout = 'single';
    var orientation = { alpha: 0, beta: 0, gamma: 0 };
    var yaw = 0;
    var pitch = 0;
    var lastPointer = null;
    var hasOrientation = false;

    var VERT_SRC =
        'attribute vec3 aPos;' +
        'attribute vec2 aUv;' +
        'uniform mat4 uMvp;' +
        'varying vec2 vUv;' +
        'void main() {' +
        '  vUv = aUv;' +
        '  gl_Position = uMvp * vec4(aPos, 1.0);' +
        '}';

    var FRAG_SRC =
        'precision mediump float;' +
        'varying vec2 vUv;' +
        'uniform sampler2D uTex;' +
        'void main() {' +
        '  gl_FragColor = texture2D(uTex, vUv);' +
        '}';

    function compileShader(src, type) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('VR shader error', gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    function initGl() {
        gl = canvas.getContext('webgl', { antialias: true }) || canvas.getContext('experimental-webgl');
        if (!gl) return false;

        var vs = compileShader(VERT_SRC, gl.VERTEX_SHADER);
        var fs = compileShader(FRAG_SRC, gl.FRAGMENT_SHADER);
        if (!vs || !fs) return false;

        glProgram = gl.createProgram();
        gl.attachShader(glProgram, vs);
        gl.attachShader(glProgram, fs);
        gl.linkProgram(glProgram);
        if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
            console.error('VR program link error', gl.getProgramInfoLog(glProgram));
            return false;
        }

        glBuffers = buildSphere(32, 32);

        glTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return true;
    }

    function buildSphere(latBands, lonBands) {
        var positions = [];
        var uvs = [];
        var indices = [];
        var radius = 10;

        for (var lat = 0; lat <= latBands; lat++) {
            var theta = (lat * Math.PI) / latBands;
            var sinT = Math.sin(theta);
            var cosT = Math.cos(theta);
            for (var lon = 0; lon <= lonBands; lon++) {
                var phi = (lon * 2 * Math.PI) / lonBands;
                var sinP = Math.sin(phi);
                var cosP = Math.cos(phi);
                var x = cosP * sinT;
                var y = cosT;
                var z = sinP * sinT;
                var u = 1 - lon / lonBands;
                var v = lat / latBands;
                positions.push(radius * x, radius * y, radius * z);
                uvs.push(u, v);
            }
        }

        for (var la = 0; la < latBands; la++) {
            for (var lo = 0; lo < lonBands; lo++) {
                var first = la * (lonBands + 1) + lo;
                var second = first + lonBands + 1;
                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }

        var posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        var uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

        var idxBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        return { pos: posBuf, uv: uvBuf, idx: idxBuf, count: indices.length };
    }

    function mat4Perspective(fovy, aspect, near, far) {
        var f = 1 / Math.tan(fovy / 2);
        var nf = 1 / (near - far);
        return [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0
        ];
    }

    function mat4Multiply(a, b) {
        var out = new Array(16);
        for (var i = 0; i < 4; i++) {
            for (var j = 0; j < 4; j++) {
                var sum = 0;
                for (var k = 0; k < 4; k++) sum += a[k * 4 + j] * b[i * 4 + k];
                out[i * 4 + j] = sum;
            }
        }
        return out;
    }

    function mat4RotateY(rad) {
        var c = Math.cos(rad), s = Math.sin(rad);
        return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    }

    function mat4RotateX(rad) {
        var c = Math.cos(rad), s = Math.sin(rad);
        return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
    }

    function getViewMatrix() {
        var rx = mat4RotateX(pitch);
        var ry = mat4RotateY(yaw);
        return mat4Multiply(ry, rx);
    }

    function drawEye(x, y, w, h) {
        gl.viewport(x, y, w, h);
        gl.scissor(x, y, w, h);
        gl.enable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.useProgram(glProgram);

        var proj = mat4Perspective((Math.PI / 180) * 90, w / h, 0.1, 100);
        var view = getViewMatrix();
        var mvp = mat4Multiply(proj, view);

        var uMvp = gl.getUniformLocation(glProgram, 'uMvp');
        gl.uniformMatrix4fv(uMvp, false, new Float32Array(mvp));

        var aPos = gl.getAttribLocation(glProgram, 'aPos');
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.pos);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        var aUv = gl.getAttribLocation(glProgram, 'aUv');
        gl.bindBuffer(gl.ARRAY_BUFFER, glBuffers.uv);
        gl.enableVertexAttribArray(aUv);
        gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        } catch (e) { }
        gl.uniform1i(gl.getUniformLocation(glProgram, 'uTex'), 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glBuffers.idx);
        gl.drawElements(gl.TRIANGLES, glBuffers.count, gl.UNSIGNED_SHORT, 0);

        gl.disable(gl.SCISSOR_TEST);
    }

    function render() {
        if (!active) return;
        resizeCanvas();

        if (video.readyState >= video.HAVE_CURRENT_DATA) {
            if (layout === 'split') {
                var halfW = canvas.width / 2;
                drawEye(0, 0, halfW, canvas.height);
                drawEye(halfW, 0, halfW, canvas.height);
            } else {
                drawEye(0, 0, canvas.width, canvas.height);
            }
        }

        rafId = requestAnimationFrame(render);
    }

    function resizeCanvas() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = Math.floor(window.innerWidth * dpr);
        var h = Math.floor(window.innerHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    function handleOrientation(e) {
        if (e.alpha === null) return;
        hasOrientation = true;
        var alphaRad = (e.alpha || 0) * (Math.PI / 180);
        var betaRad = (e.beta || 0) * (Math.PI / 180);
        yaw = -alphaRad;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, betaRad - Math.PI / 2));
    }

    function handlePointerDown(e) {
        if (hasOrientation && mode === 'mono') return;
        lastPointer = { x: e.clientX, y: e.clientY };
    }

    function handlePointerMove(e) {
        if (!lastPointer) return;
        var dx = e.clientX - lastPointer.x;
        var dy = e.clientY - lastPointer.y;
        lastPointer = { x: e.clientX, y: e.clientY };
        yaw -= dx * 0.005;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - dy * 0.005));
    }

    function handlePointerUp() {
        lastPointer = null;
    }

    function handleTouchMove(e) {
        if (e.touches.length !== 1) return;
        var t = e.touches[0];
        if (!lastPointer) {
            lastPointer = { x: t.clientX, y: t.clientY };
            return;
        }
        var dx = t.clientX - lastPointer.x;
        var dy = t.clientY - lastPointer.y;
        lastPointer = { x: t.clientX, y: t.clientY };
        yaw -= dx * 0.005;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - dy * 0.005));
    }

    function handleTouchEnd() {
        lastPointer = null;
    }

    function requestOrientationPermission() {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(function (state) {
                if (state === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                }
                startVr();
            }).catch(function () {
                startVr();
            });
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
            startVr();
        }
    }

    function startVr() {
        if (permissionBtn) permissionBtn.style.display = 'none';
        if (!gl && !initGl()) {
            console.error('VR: WebGL unavailable');
            return;
        }

        active = true;
        yaw = 0;
        pitch = 0;
        canvas.style.display = 'block';

        canvas.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('mousemove', handlePointerMove);
        window.addEventListener('mouseup', handlePointerUp);
        canvas.addEventListener('touchstart', function (e) {
            if (e.touches.length === 1) lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
        canvas.addEventListener('touchend', handleTouchEnd);

        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        if (typeof video.play === 'function') video.play().catch(function () { });

        render();
    }

    function stopVr() {
        active = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        canvas.style.display = 'none';
        if (permissionBtn) permissionBtn.style.display = 'none';
        window.removeEventListener('deviceorientation', handleOrientation);
        canvas.removeEventListener('mousedown', handlePointerDown);
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mouseup', handlePointerUp);
        window.removeEventListener('resize', resizeCanvas);
        hasOrientation = false;
        lastPointer = null;
    }

    function enterVr() {
        var needsOrientation = mode === 'mono';
        if (needsOrientation && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            if (permissionBtn) permissionBtn.style.display = 'flex';
        } else {
            if (needsOrientation) window.addEventListener('deviceorientation', handleOrientation);
            startVr();
        }
    }

    function applyModeVisibility() {
        var isOn = toggle.classList.contains('on');
        if (splitRow) splitRow.style.display = isOn ? 'flex' : 'none';
        if (projectionRow) projectionRow.style.display = isOn ? 'flex' : 'none';
    }

    toggle.addEventListener('click', function () {
        var willBeOn = !toggle.classList.contains('on');
        toggle.classList.toggle('on', willBeOn);
        applyModeVisibility();

        if (willBeOn) {
            enterVr();
        } else {
            stopVr();
        }
    });

    if (permissionConfirm) {
        permissionConfirm.addEventListener('click', requestOrientationPermission);
    }

    if (splitSelect) {
        splitSelect.addEventListener('change', function () {
            layout = splitSelect.value === 'split' ? 'split' : 'single';
        });
    }

    if (projectionSelect) {
        projectionSelect.addEventListener('change', function () {
            mode = projectionSelect.value === 'stereo' ? 'stereo' : 'mono';
            if (mode === 'stereo' && splitSelect) {
                splitSelect.value = 'split';
                layout = 'split';
            }
            if (active) {
                stopVr();
                toggle.classList.add('on');
                enterVr();
            }
        });
    }

    applyModeVisibility();
})();