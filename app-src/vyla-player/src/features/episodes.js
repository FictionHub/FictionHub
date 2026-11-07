(function () {
    var s = window.store.s;
    var e = window.store.e;
    var id = window.store.id;

    if (!s) return;

    var epPanelBackdrop = document.getElementById('ep-panel-backdrop');
    var epPanel = document.getElementById('ep-panel');
    var epPanelSeasonView = document.getElementById('ep-panel-season-view');
    var epPanelEpisodeView = document.getElementById('ep-panel-episode-view');
    var epPanelShowTitle = document.getElementById('ep-panel-show-title');
    var epPanelSeasonTitle = document.getElementById('ep-panel-season-title');
    var epSeasonList = document.getElementById('ep-season-list');
    var epPanelEpList = document.getElementById('ep-panel-ep-list');
    var epPanelClose = document.getElementById('ep-panel-close');
    var epPanelEpBack = document.getElementById('ep-panel-ep-back');
    var epPanelCloseBtn = document.getElementById('ep-panel-close-btn');
    var btnEpisodes = document.getElementById('btn-episodes');

    var _epTotalSeasons = 1;
    var _epSeasonCache = {};
    var _epActiveSeason = parseInt(s);
    var _epCurrentEpisode = parseInt(e || '1');

    function openEpPanel() {
        epPanelBackdrop.style.display = 'block';
        requestAnimationFrame(function () {
            epPanelBackdrop.classList.add('open');
            epPanel.classList.add('open');
        });
        showEpSeasonView();
    }

    function closeEpPanel() {
        epPanelBackdrop.classList.remove('open');
        epPanel.classList.remove('open');
        setTimeout(function () { epPanelBackdrop.style.display = 'none'; }, 300);
    }

    function showEpSeasonView() {
        epPanelSeasonView.style.display = 'flex';
        epPanelSeasonView.style.flexDirection = 'column';
        epPanelEpisodeView.style.display = 'none';
        buildSeasonRows(epSeasonList, function (season) {
            showEpEpisodeView(season);
        });
    }

    function showEpEpisodeView(season) {
        epPanelSeasonTitle.textContent = 'Season ' + season;
        epPanelSeasonView.style.display = 'none';
        epPanelEpisodeView.style.display = 'flex';
        epPanelEpisodeView.style.flexDirection = 'column';
        buildPanelEpRows(season, epPanelEpList, function (epNum) {
            closeEpPanel();
            if (epNum !== _epCurrentEpisode || season !== _epActiveSeason) {
                location.href = location.pathname + '?id=' + id + '&season=' + season + '&episode=' + epNum + '&ap=1';
            }
        });
    }

    function buildSeasonRows(container, onSelect) {
        container.innerHTML = '';
        for (var i = 1; i <= _epTotalSeasons; i++) {
            (function (season) {
                var row = document.createElement('div');
                row.className = 'ep-season-row';
                row.innerHTML = 'Season ' + season + '<i class="fa-solid fa-chevron-right"></i>';
                row.addEventListener('click', function () { window.haptic(6); onSelect(season); });
                container.appendChild(row);
            })(i);
        }
    }

    function buildPanelEpRows(season, container, onSelect) {
        container.innerHTML = '<div style="padding:20px;text-align:center;"><svg width="28" height="28" viewBox="0 0 52 52" style="animation:_vyla_spin 0.9s linear infinite"><circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="3.5" stroke-dasharray="100" stroke-dashoffset="70"/></svg></div>';
        fetchSeason(season, function (eps) {
            container.innerHTML = '';
            eps.forEach(function (ep) {
                var isCurrent = season === _epActiveSeason && ep.episode_number === _epCurrentEpisode;
                var row = document.createElement('div');
                row.className = 'ep-panel-ep-row' + (isCurrent ? ' current' : '');
                var thumbHtml = '<div class="ep-panel-ep-thumb">';
                if (ep.still_path) {
                    thumbHtml += '<img src="https://image.tmdb.org/t/p/w185' + ep.still_path + '" alt="">';
                } else {
                    thumbHtml += '<div class="ep-panel-ep-thumb-placeholder"><i class="fa-solid fa-film"></i></div>';
                }
                thumbHtml += '<span class="ep-panel-ep-badge">E' + ep.episode_number + '</span></div>';
                row.innerHTML = thumbHtml + '<div class="ep-panel-ep-info"><div class="ep-panel-ep-name">' + (ep.name || 'Episode ' + ep.episode_number) + '</div><div class="ep-panel-ep-meta">' + (ep.runtime ? ep.runtime + ' min' : '') + '</div></div>';
                if (!isCurrent) {
                    row.addEventListener('click', function () { window.haptic(10); onSelect(ep.episode_number); });
                }
                container.appendChild(row);
            });
            var cur = container.querySelector('.current');
            if (cur) setTimeout(function () { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 80);
        });
    }

    function fallbackEps(season) {
        var arr = [];
        var count = (_epSeasonCache['_count_' + season]) || 20;
        for (var i = 1; i <= count; i++) arr.push({ episode_number: i, name: 'Episode ' + i, runtime: null, still_path: null });
        return arr;
    }

    function fetchSeason(season, cb) {
        if (_epSeasonCache[season] && _epSeasonCache[season]._real) { cb(_epSeasonCache[season]); return; }
        fetch('https://api.themoviedb.org/3/tv/' + id + '/season/' + season + '?api_key=' + window.TMDB_KEY + '&language=en-US&append_to_response=images')
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (d) {
                if (!d.episodes || !d.episodes.length) throw new Error('no episodes');
                d.episodes._real = true;
                _epSeasonCache[season] = d.episodes;
                _epSeasonCache[season]._real = true;
                cb(_epSeasonCache[season]);
            })
            .catch(function () {
                _epSeasonCache[season] = null;
                cb(fallbackEps(season));
            });
    }

    fetch('https://api.themoviedb.org/3/tv/' + id + '?api_key=' + window.TMDB_KEY)
        .then(function (r) { return r.json(); })
        .then(function (d) {
            _epTotalSeasons = d.number_of_seasons || parseInt(s);
            if (epPanelShowTitle) epPanelShowTitle.textContent = d.name || '';
            if (btnEpisodes) btnEpisodes.style.display = '';
        })
        .catch(function () {
            if (btnEpisodes) btnEpisodes.style.display = '';
        });

    btnEpisodes && btnEpisodes.addEventListener('click', function (ev) { ev.stopPropagation(); openEpPanel(); window.haptic(10); });
    epPanelClose && epPanelClose.addEventListener('click', function () { closeEpPanel(); window.haptic(6); });
    epPanelCloseBtn && epPanelCloseBtn.addEventListener('click', function () { closeEpPanel(); window.haptic(6); });
    epPanelBackdrop && epPanelBackdrop.addEventListener('click', function () { closeEpPanel(); });
    epPanelEpBack && epPanelEpBack.addEventListener('click', function () { showEpSeasonView(); window.haptic(6); });
})();