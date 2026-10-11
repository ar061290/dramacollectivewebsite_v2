// Piano music, off by default and only ever started by the visitor. Public-domain and CC0
// recordings from Musopen, streamed from Wikimedia Commons (credited in the footer), played in turn
// and looped. Fades in and out; pauses while the tab is hidden and picks up again on return.
import gsap from 'gsap';

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';
const VOLUME = 0.5;

export const TRACKS = [
  {
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    performer: 'Robin Alciatore',
    path: '9/90/Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg',
  },
  {
    title: 'Sonata Pathétique, II. Adagio cantabile',
    composer: 'Ludwig van Beethoven',
    performer: 'Paul Pitman',
    path: '6/63/Beethoven%2C_Sonata_No._8_in_C_Minor_Pathetique%2C_Op._13_-_II._Adagio_cantabile.ogg',
  },
  {
    title: 'Nocturne in F major, Op. 15 No. 1',
    composer: 'Frédéric Chopin',
    performer: 'Luke Faulkner',
    path: '5/56/Chopin_-_Nocturne_Op._15_no._1_in_F_major.ogg',
  },
];

export function setupMusic({ reduced }) {
  const button = document.querySelector('[data-music-toggle]');
  if (!button) return () => {};
  const audio = new Audio();
  audio.preload = 'none';
  // Ogg Vorbis where supported (smaller); Wikimedia's MP3 copy elsewhere (Safari)
  const ogg = audio.canPlayType('audio/ogg; codecs="vorbis"') !== '';
  const src = (t) => {
    if (ogg) return COMMONS + t.path;
    const [a, b, file] = t.path.split('/');
    return `${COMMONS}transcoded/${a}/${b}/${file}/${file}.mp3`;
  };

  let index = 0;
  let wanted = false; // the visitor's choice; the audio may be briefly paused while the tab is hidden
  let failures = 0;
  let fade = null;

  const label = () => {
    const t = TRACKS[index];
    button.title = wanted ? `Now playing: ${t.composer}, ${t.title}` : 'Play piano music';
  };
  const setUi = () => {
    button.setAttribute('aria-pressed', String(wanted));
    button.classList.toggle('is-playing', wanted && !audio.paused);
    if (!wanted) button.classList.remove('is-loading');
    label();
  };

  const load = (i) => {
    index = (i + TRACKS.length) % TRACKS.length;
    audio.src = src(TRACKS[index]);
    if ('mediaSession' in navigator && window.MediaMetadata) {
      const t = TRACKS[index];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: `${t.composer} · ${t.performer}`,
        album: 'The Drama Collective',
      });
    }
  };

  const fadeTo = (volume, duration, onComplete) => {
    fade?.kill();
    fade = gsap.to(audio, { volume, duration: reduced ? 0 : duration, ease: 'sine.inOut', onComplete });
  };

  const start = async () => {
    if (!audio.src) load(index);
    fade?.kill();
    if (audio.paused) audio.volume = 0;
    try {
      await audio.play();
    } catch (err) {
      if (err?.name !== 'AbortError') { wanted = false; console.warn('Music could not start.', err); }
      setUi();
      return;
    }
    fadeTo(VOLUME, 1.6);
    setUi();
  };

  const stop = () => fadeTo(0, 0.6, () => { audio.pause(); setUi(); });

  const onClick = () => {
    wanted = !wanted;
    if (wanted) start(); else stop();
    setUi();
  };

  // the playlist: next piece at the end; skip a piece that will not load (up to one full round)
  const onEnded = () => { load(index + 1); if (wanted) start(); };
  const onError = () => {
    if (!audio.src || ++failures > TRACKS.length) { wanted = false; setUi(); return; }
    load(index + 1);
    if (wanted) start();
  };
  const onPlaying = () => { failures = 0; setUi(); };
  const onWaiting = () => button.classList.add('is-loading');
  const onCanPlay = () => button.classList.remove('is-loading');
  const onVisibility = () => {
    if (!wanted) return;
    if (document.hidden) { fade?.kill(); audio.pause(); } else start();
  };

  button.addEventListener('click', onClick);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', onError);
  audio.addEventListener('playing', onPlaying);
  audio.addEventListener('pause', setUi);
  audio.addEventListener('waiting', onWaiting);
  audio.addEventListener('canplay', onCanPlay);
  document.addEventListener('visibilitychange', onVisibility);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { if (!wanted) onClick(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (wanted) onClick(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { load(index + 1); if (wanted) start(); });
  }
  setUi();

  return () => {
    fade?.kill();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    button.removeEventListener('click', onClick);
    audio.removeEventListener('ended', onEnded);
    audio.removeEventListener('error', onError);
    audio.removeEventListener('playing', onPlaying);
    audio.removeEventListener('pause', setUi);
    audio.removeEventListener('waiting', onWaiting);
    audio.removeEventListener('canplay', onCanPlay);
    document.removeEventListener('visibilitychange', onVisibility);
    if ('mediaSession' in navigator) {
      for (const action of ['play', 'pause', 'nexttrack']) navigator.mediaSession.setActionHandler(action, null);
    }
  };
}
