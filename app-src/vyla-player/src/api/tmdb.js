window.setTitleWithTmdbImage = async function (titleText, meta) {
    var titleElement = document.getElementById('title-text');
    var logo = null;
    if (meta && meta.images && meta.images.logos && meta.images.logos.length > 0) {
        logo = meta.images.logos.find(function (l) { return l.iso_639_1 === 'en'; });
        if (!logo) logo = meta.images.logos.find(function (l) { return !l.iso_639_1 || l.iso_639_1 === 'xx'; });
        if (!logo) logo = meta.images.logos[0];
    }
    if (!logo && meta && meta.logo_object && meta.logo_object.file_path) {
        logo = meta.logo_object;
    }
    if (!logo) {
        var tmdbId = meta && (meta.tmdb_id || meta.id);
        var mediaType = store.s ? 'tv' : 'movie';
        if (tmdbId) {
            try {
                var res = await fetch('https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '/images?api_key=' + window.TMDB_KEY);
                var imgData = await res.json();
                var logos = imgData.logos || [];
                if (logos.length > 0) {
                    logo = logos.find(function (l) { return l.iso_639_1 === 'en'; });
                    if (!logo) logo = logos.find(function (l) { return !l.iso_639_1 || l.iso_639_1 === 'xx'; });
                    if (!logo) logo = logos[0];
                }
            } catch (e) { }
        }
    }
    if (logo && logo.file_path) {
        var logoUrl = 'https://image.tmdb.org/t/p/w300' + logo.file_path;
        titleElement.innerHTML = '<img src="' + logoUrl + '" alt="' + titleText + '" style="max-height:24px;max-width:200px;object-fit:contain;">';
    } else {
        titleElement.textContent = titleText;
    }
}