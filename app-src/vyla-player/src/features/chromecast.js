window.__onGCastApiAvailable = function (isAvailable) {
    if (isAvailable) {
        cast.framework.CastContext.getInstance().setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });
    }
};

const s = document.createElement('script');
s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
document.head.appendChild(s);

document.getElementById('btn-cast')?.addEventListener('click', async () => {
    try {
        const ctx = cast.framework.CastContext.getInstance();
        let session = ctx.getCurrentSession();
        if (!session) {
            await ctx.requestSession();
            session = ctx.getCurrentSession();
        }
        if (!session) return;

        const v = document.getElementById('v');
        const mediaInfo = new chrome.cast.media.MediaInfo(v.src, 'video/mp4');
        const metadata = new chrome.cast.media.GenericMediaMetadata();
        metadata.title = document.title;
        mediaInfo.metadata = metadata;

        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        request.currentTime = v.currentTime;

        await session.loadMedia(request);
        v.pause();
    } catch (e) { }
});