(function () {
    var staticLangMap = {
        'english': 'us', 'spanish': 'es', 'french': 'fr', 'german': 'de', 'italian': 'it',
        'portuguese': 'pt', 'russian': 'ru', 'chinese': 'cn', 'japanese': 'jp', 'korean': 'kr',
        'arabic': 'sa', 'hindi': 'in', 'bengali': 'bd', 'turkish': 'tr', 'vietnamese': 'vn',
        'thai': 'th', 'dutch': 'nl', 'polish': 'pl', 'indonesian': 'id', 'malay': 'my',
        'greek': 'gr', 'swedish': 'se', 'danish': 'dk', 'finnish': 'fi', 'norwegian': 'no'
    };

    window.getLangCode = function (label) {
        if (!label) return null;
        var key = label.toLowerCase().replace(/[^a-z]/g, ' ').trim().split(' ')[0];
        return staticLangMap[key] || null;
    };

    window.flagImg = function (code) {
        if (!code) return '<span style="width:26px;height:20px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fa-solid fa-globe" style="font-size:13px;color:rgba(255,255,255,0.3);"></i></span>';
        return '<img class="slg-flag" src="https://flagcdn.com/20x15/' + code.toLowerCase() + '.png" width="26" height="20" style="border-radius:2px;object-fit:cover;" alt="">';
    };

})();