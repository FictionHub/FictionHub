import { TMDB_KEY } from '../config.js';
import { store } from '../state.js';

export let alive = true;
export let shouldHideLoader = false;

export function setShouldHideLoader(val) { shouldHideLoader = val; }

export function initLoaderBackdrop() {
    var loaderBg = document.getElementById('loader-bg');
    if (!loaderBg) return;

    if (!store.id) return;

    var isTv = !!store.s;
    var tmdbUrl = isTv ? 'https://api.themoviedb.org/3/tv/' + store.id + '?api_key=' + TMDB_KEY : 'https://api.themoviedb.org/3/movie/' + store.id + '?api_key=' + TMDB_KEY;

    fetch(tmdbUrl)
        .then(function (response) {
            if (!response.ok) throw new Error('TMDB fetch failed');
            return response.json();
        })
        .then(function (data) {
            if (data.success === false) return;
            var backdropPath = data.backdrop_path;
            if (backdropPath) {
                var backdropUrl = 'https://image.tmdb.org/t/p/original' + backdropPath;
                loaderBg.style.backgroundImage = 'url(' + backdropUrl + ')';
            } else {
                var posterPath = data.poster_path;
                if (posterPath) {
                    var posterUrl = 'https://image.tmdb.org/t/p/w1280' + posterPath;
                    loaderBg.style.backgroundImage = 'url(' + posterUrl + ')';
                }
            }
        })
}

export function hideLoader() {
    var loader = document.getElementById('loader');
    loader.classList.add('out');
    setTimeout(function () {
        alive = false;
        loader.style.display = 'none';
    }, 1000);
}