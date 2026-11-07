export const _hxInput = (function () {
    if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return null;
    var s = document.createElement('input');
    s.type = 'checkbox';
    s.setAttribute('switch', '');
    s.setAttribute('inert', '');
    s.tabIndex = -1;
    s.style.cssText = 'position:fixed;top:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(s);
    var l = document.createElement('label');
    l.htmlFor = s.id = '__hx';
    l.style.cssText = 'position:fixed;top:-9999px;opacity:0;pointer-events:none;';
    document.body.appendChild(l);
    return l;
})();

export function haptic() {
    if (_hxInput) _hxInput.click();
}

(function () {
    if (!_hxInput) return;
    var SELECTOR = [
        'button', 'a[href]', '[role="button"]', '[role="tab"]',
        '[role="option"]', '[role="menuitem"]', '[tabindex]',
        '.settings-list-item', '.ep-item', '.ep-season-pill',
        '.ctrl-btn', '#track-wrap', '#next-ep-inner'
    ].join(',');
    document.addEventListener('click', function (e) {
        if (e.target.id === '__hx') return;
        var el = e.target.closest(SELECTOR);
        if (el) haptic();
    }, true);
    document.addEventListener('input', function (e) {
        if (e.target.type === 'range') haptic();
    }, true);
})();