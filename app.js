let songDatabase = [];
let albumDatabase = [];
let currentActiveSong = null;
let currentChartIndex = 0;
let isRestoringState = false;
let currentAlbumSortMode = "track"; // 'track' (1..N) or 'alpha' (A..Z)

// Sticky user streaming preference (persisted in localStorage, default: "youtube")
function getUserStreamPreference() {
    try {
        const pref = localStorage.getItem("by_stream_preference");
        if (pref === "spotify" || pref === "youtube") return pref;
    } catch (e) {}
    return "youtube";
}

function setUserStreamPreference(pref) {
    if (pref !== "spotify" && pref !== "youtube") return;
    try {
        localStorage.setItem("by_stream_preference", pref);
    } catch (e) {}
}

// Collapsible sidebar management for Desktop, Tablet & Mobile portrait modes
function isMobileView() {
    return window.innerWidth <= 900;
}

function closeMobileSidebar() {
    if (isMobileView()) {
        document.body.classList.remove("sidebar-open");
    }
}

function toggleSidebar() {
    if (isMobileView()) {
        document.body.classList.toggle("sidebar-open");
    } else {
        const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
        try {
            localStorage.setItem("by_sidebar_collapsed", isCollapsed ? "true" : "false");
        } catch (e) {}
    }
}

function setupSidebarToggle() {
    const toggleBtn = document.getElementById("sidebar-toggle-btn");
    const backdrop = document.getElementById("sidebar-backdrop");

    if (toggleBtn) {
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            toggleSidebar();
        };
    }

    if (backdrop) {
        backdrop.onclick = () => {
            closeMobileSidebar();
        };
    }

    // Restore desktop collapsed preference
    try {
        if (!isMobileView() && localStorage.getItem("by_sidebar_collapsed") === "true") {
            document.body.classList.add("sidebar-collapsed");
        }
    } catch (e) {}

    // Keyboard shortcuts: '[' to toggle, Escape to close mobile drawer
    document.addEventListener("keydown", (e) => {
        // Do not trigger if user is in an input / select
        if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) {
            return;
        }
        if (e.key === "[" || e.key === "b" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            toggleSidebar();
        } else if (e.key === "Escape") {
            if (isMobileView() && document.body.classList.contains("sidebar-open")) {
                closeMobileSidebar();
            }
        }
    });

    // Close mobile drawer on resize to larger viewport to avoid lingering state
    window.addEventListener("resize", () => {
        if (!isMobileView()) {
            document.body.classList.remove("sidebar-open");
        }
    });
}

let currentMobilePaneMode = "both";
function setMobilePaneMode(mode) {
    const modes = ["both", "chart", "lyrics"];
    const modeLabels = {
        "both": "Both",
        "chart": "Chords",
        "lyrics": "Lyrics"
    };
    if (!modes.includes(mode)) mode = "both";
    currentMobilePaneMode = mode;

    document.body.classList.remove("mobile-mode-chart", "mobile-mode-lyrics");
    if (mode === "chart") {
        document.body.classList.add("mobile-mode-chart");
    } else if (mode === "lyrics") {
        document.body.classList.add("mobile-mode-lyrics");
    }

    const labelElem = document.getElementById("mobile-view-label");
    const toggleBtn = document.getElementById("mobile-view-toggle");
    if (labelElem) {
        labelElem.innerText = modeLabels[mode] || "Both";
    }
    if (toggleBtn) {
        toggleBtn.title = `Current: ${modeLabels[mode]} (Tap to rotate view)`;
    }
}

// Setup Mobile Rotating View Mode Toggle: [ Both -> Chords -> Lyrics -> Both ]
function setupMobileViewToggle() {
    const toggleBtn = document.getElementById("mobile-view-toggle");
    if (!toggleBtn) return;

    const modes = ["both", "chart", "lyrics"];

    toggleBtn.onclick = (e) => {
        e.stopPropagation();
        const nextIdx = (modes.indexOf(currentMobilePaneMode) + 1) % modes.length;
        setMobilePaneMode(modes[nextIdx]);
    };

    // Initialize to "both"
    setMobilePaneMode("both");
}

// Setup Settings popover and radio listeners
function setupSettingsPopover() {
    const btn = document.getElementById("settings-btn");
    const popover = document.getElementById("settings-popover");
    if (!btn || !popover) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        popover.classList.toggle("open");
    };

    document.addEventListener("click", (e) => {
        if (!popover.contains(e.target) && e.target !== btn) {
            popover.classList.remove("open");
        }
    });

    const radios = document.querySelectorAll('input[name="stream-pref"]');
    const currentPref = getUserStreamPreference();
    radios.forEach(radio => {
        if (radio.value === currentPref) radio.checked = true;
        radio.onchange = () => {
            if (radio.checked) {
                setUserStreamPreference(radio.value);
                // Re-evaluate active audio player immediately
                if (currentActiveSong) {
                    renderAudio(currentActiveSong);
                }
            }
        };
    });

    const reloadBtn = document.getElementById("force-reload-btn");
    if (reloadBtn) {
        reloadBtn.onclick = (e) => {
            e.stopPropagation();
            // Force cache-busting reload by appending a fresh timestamp query
            const url = new URL(window.location.href);
            url.searchParams.set("_reload", Date.now());
            window.location.replace(url.toString());
        };
    }
}

// Helper to extract clean slug from a song URL or identifier
function getSongSlug(song) {
    if (!song) return "";
    const raw = song.song_url || song.url || "";
    const trimmed = raw.replace(/\/+$/, '');
    const parts = trimmed.split('/');
    return parts[parts.length - 1].toLowerCase();
}

// ----------------------------------------------------
// VIEW-STATE ARCHITECTURE (URL Query Parameters & History)
// ----------------------------------------------------

function readViewStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return {
        songSlug: (params.get("song") || "").trim().toLowerCase(),
        album: (params.get("album") || "").trim().toLowerCase(),
        chartIndex: parseInt(params.get("chart") || "0", 10) || 0
    };
}

function updateViewStateUrl(options = {}) {
    if (isRestoringState) return;

    const params = new URLSearchParams();
    const filterSelect = document.getElementById("album-filter");
    const currentAlbum = (filterSelect?.value || "all").trim().toLowerCase();

    // 1. Album filter (only present if not 'all')
    if (currentAlbum && currentAlbum !== "all") {
        params.set("album", currentAlbum);
    }

    // 2. Selected song slug
    if (currentActiveSong) {
        const slug = getSongSlug(currentActiveSong);
        if (slug) params.set("song", slug);
    }

    // 3. Selected chart index (only present if alternate > 0)
    if (currentChartIndex > 0) {
        params.set("chart", currentChartIndex.toString());
    }

    const newQuery = params.toString();
    const newRelativePathQuery = window.location.pathname + (newQuery ? '?' + newQuery : '') + window.location.hash;
    
    // Only update if URL actually changed
    if (window.location.search !== (newQuery ? '?' + newQuery : '')) {
        if (options.replace) {
            window.history.replaceState({ songSlug: getSongSlug(currentActiveSong), chartIndex: currentChartIndex, album: currentAlbum }, '', newRelativePathQuery);
        } else {
            window.history.pushState({ songSlug: getSongSlug(currentActiveSong), chartIndex: currentChartIndex, album: currentAlbum }, '', newRelativePathQuery);
        }
    }
}

function resetToUnselectedState() {
    currentActiveSong = null;
    currentChartIndex = 0;
    updateActiveSongHighlight();

    // Reset title bar
    const titleElem = document.getElementById("active-song-title");
    if (titleElem) titleElem.innerHTML = "Select a song";

    // Reset audio players
    renderAudio(null);

    // Reset chords pane
    const tuningMetaElem = document.getElementById("chart-tuning-meta");
    if (tuningMetaElem) tuningMetaElem.innerText = "";

    const selectorContainer = document.getElementById("version-selector");
    if (selectorContainer) {
        selectorContainer.innerHTML = "";
        selectorContainer.style.display = "none";
    }

    const chartContainer = document.getElementById("chart-container");
    if (chartContainer) {
        chartContainer.innerHTML = "<p style='color: #71717a;'>Choose a song from the playlist to view its chords/chart.</p>";
    }

    // Reset feedback button
    const feedbackBtn = document.getElementById("feedback-btn");
    if (feedbackBtn) {
        feedbackBtn.href = "mailto:matthew.siegler@gmail.com?subject=Brad%20Yoder%20Repertoire%20Feedback";
    }

    // Reset lyrics pane
    const lyricsContainer = document.getElementById("lyrics-container");
    if (lyricsContainer) {
        lyricsContainer.innerHTML = "<p style='color: #71717a;'>Choose a song from the playlist to view its lyrics.</p>";
    }
}

// Restore entire view-state from URL query params with graceful backoff
function restoreViewStateFromUrl(options = {}) {
    isRestoringState = true;
    try {
        const { songSlug, album, chartIndex } = readViewStateFromUrl();
        const filterSelect = document.getElementById("album-filter");

        // 1. Resolve Target Song (if provided)
        let targetSong = null;
        if (songSlug) {
            targetSong = songDatabase.find(s => getSongSlug(s) === songSlug);
        }

        // 2. Resolve Album Filter
        let targetAlbum = "all";
        if (album && album !== "all") {
            const albumExists = albumDatabase.some(a => (a.album_id || "").toLowerCase() === album);
            if (albumExists) {
                if (targetSong) {
                    const songAlbum = (targetSong.album_id || "").toLowerCase();
                    if (songAlbum === album) {
                        targetAlbum = album;
                    } else {
                        console.info(`Requested song '${songSlug}' is from album '${songAlbum}', backing off filter from '${album}' to 'all'`);
                        targetAlbum = "all";
                    }
                } else {
                    targetAlbum = album;
                }
            } else {
                console.warn(`Album '${album}' not recognized, backing off to 'all'`);
                targetAlbum = "all";
            }
        }

        // Apply album filter to dropdown and update sort toggle UI
        if (filterSelect) {
            filterSelect.value = targetAlbum;
        }
        updateSortToggleUI();

        // Filter and render playlist
        const visibleSongs = getSortedSongsForAlbum(targetAlbum, currentAlbumSortMode);

        // 3. Selection handling:
        // If song is valid, select it.
        // If song was bogus or not provided, render unselected and clear query params.
        if (targetSong) {
            currentActiveSong = targetSong;
            renderSongList(visibleSongs);
            selectSong(targetSong, {
                chartIndex: chartIndex >= 0 ? chartIndex : 0,
                scrollIntoView: true,
                skipUrlSync: true
            });
        } else {
            currentActiveSong = null;
            renderSongList(visibleSongs);
            resetToUnselectedState();
        }
    } finally {
        isRestoringState = false;
    }

    // Ensure URL aligns with normalized state (clearing bogus/unselected params)
    updateViewStateUrl({ replace: true });
}

// Listen for browser Back / Forward history navigation
window.addEventListener("popstate", () => {
    restoreViewStateFromUrl({ replaceUrl: true });
});

// Configure PDF.js worker
// Application build version constant for cache busting & runtime display
const APP_BUILD_VERSION = "v1.34";

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// 1. Load and parse normalized datasets on startup, joining on song URL & album_id
async function initApp() {
    try {
        const [songsRes, albumsRes, chartsRes, lyricsRes, audioRes] = await Promise.all([
            fetch(`songs.csv?v=${APP_BUILD_VERSION}`),
            fetch(`albums.csv?v=${APP_BUILD_VERSION}`),
            fetch(`charts.csv?v=${APP_BUILD_VERSION}`).catch(() => null),
            fetch(`lyrics.csv?v=${APP_BUILD_VERSION}`).catch(() => null),
            fetch(`audio.csv?v=${APP_BUILD_VERSION}`).catch(() => null)
        ]);

        const songsCsvText = await songsRes.text();
        const albumsCsvText = await albumsRes.text();
        let songs = parseCSV(songsCsvText);
        albumDatabase = parseCSV(albumsCsvText);

        // Build album map
        const albumMap = {};
        albumDatabase.forEach(a => {
            const id = (a.album_id || "").trim().toLowerCase();
            if (id) albumMap[id] = a;
        });

        // Build charts map
        const chartsMap = {};
        if (chartsRes && chartsRes.ok) {
            const chartsCsvText = await chartsRes.text();
            const chartEntries = parseCSV(chartsCsvText);
            chartEntries.forEach(entry => {
                const urlKey = (entry.url || "").trim().toLowerCase();
                if (urlKey) chartsMap[urlKey] = entry;
            });
        }

        // Build lyrics map
        const lyricsMap = {};
        if (lyricsRes && lyricsRes.ok) {
            const lyricsCsvText = await lyricsRes.text();
            const lyricsEntries = parseCSV(lyricsCsvText);
            lyricsEntries.forEach(entry => {
                const urlKey = (entry.url || "").trim().toLowerCase();
                if (urlKey) lyricsMap[urlKey] = entry;
            });
        }

        // Build audio map
        const audioMap = {};
        if (audioRes && audioRes.ok) {
            const audioCsvText = await audioRes.text();
            const audioEntries = parseCSV(audioCsvText);
            audioEntries.forEach(entry => {
                const urlKey = (entry.url || entry.song_url || Object.values(entry)[0] || "").trim().toLowerCase();
                if (urlKey) audioMap[urlKey] = entry;
            });
        }

        // Relational join
        songs = songs.map(song => {
            const songUrl = (song.url || song.song_url || "").trim().toLowerCase();
            const albId = (song.album_id || "").trim().toLowerCase();
            const matchedAlbum = albumMap[albId] || {};
            const matchedCharts = chartsMap[songUrl] || {};
            const matchedLyrics = lyricsMap[songUrl] || {};
            const matchedAudio = audioMap[songUrl] || {};

            return {
                ...song,
                song_url: song.url,
                album_id: albId,
                source_album: matchedAlbum.title || song.source_album || albId,
                chart_alternates: matchedCharts.chart_alternates || "",
                alternate_count: matchedCharts.alternate_count || "0",
                lyrics_json: matchedLyrics.lyrics_json || '{"stanzas": []}',
                audio_uri: matchedAudio.audio_uri || "",
                track_id: matchedAudio.track_id || "",
                bandcamp_album_id: matchedAudio.bandcamp_album_id || "",
                embed_url: matchedAudio.embed_url || "",
                youtube_id: matchedAudio.youtube_id || "",
                spotify_id: matchedAudio.spotify_id || ""
            };
        });

        // Sort songs alphabetically by title
        songs.sort((a, b) => {
            const titleA = (a.title || "").toLowerCase();
            const titleB = (b.title || "").toLowerCase();
            return titleA.localeCompare(titleB);
        });

        songDatabase = songs;
        setupAlbumFilter();
        setupSettingsPopover();
        setupSidebarToggle();
        setupMobileViewToggle();
        setupTransposeControls();
        
        const versionBadge = document.getElementById("app-version-badge");
        if (versionBadge) {
            versionBadge.innerText = APP_BUILD_VERSION;
        }

        // Environment Badge detection (shows DEV badge only if on dev origin/hostname/path)
        const isDevEnv = window.location.hostname === "localhost" || 
                         window.location.hostname === "127.0.0.1" || 
                         window.location.pathname.includes("bradyoder-dev") ||
                         window.location.hostname.includes("lhr.life");
        const envBadge = document.getElementById("env-badge");
        if (envBadge && isDevEnv) {
            envBadge.classList.add("env-badge-dev");
        }

        // Restore initial view-state from URL query params
        restoreViewStateFromUrl({ replaceUrl: true });
    } catch (err) {
        console.error("Failed to load datasets:", err);
        document.getElementById("song-list").innerHTML = "<div style='padding: 20px; color: red;'>Error loading datasets. Ensure your local server is running.</div>";
    }
}

// 2. Setup Discography album filter dropdown and sorting
function getSortedSongsForAlbum(albumId, sortMode) {
    if (albumId === "all") {
        return [...songDatabase].sort((a, b) => {
            const titleA = (a.title || "").toLowerCase();
            const titleB = (b.title || "").toLowerCase();
            return titleA.localeCompare(titleB);
        });
    }

    const filtered = songDatabase.filter(s => (s.album_id || "").toLowerCase() === albumId);
    if (sortMode === "track") {
        return [...filtered].sort((a, b) => {
            const trackA = parseInt(a.track_number || "999", 10);
            const trackB = parseInt(b.track_number || "999", 10);
            if (trackA !== trackB) return trackA - trackB;
            return (a.title || "").localeCompare(b.title || "");
        });
    } else {
        return [...filtered].sort((a, b) => {
            return (a.title || "").localeCompare(b.title || "");
        });
    }
}

function updateSortToggleUI() {
    const filterSelect = document.getElementById("album-filter");
    const toggleContainer = document.getElementById("album-sort-toggle");
    const sortBtn = document.getElementById("album-sort-btn");
    if (!toggleContainer || !sortBtn) return;

    const currentAlbum = (filterSelect?.value || "all").toLowerCase();
    if (currentAlbum === "all") {
        toggleContainer.style.display = "none";
    } else {
        toggleContainer.style.display = "flex";
        if (currentAlbumSortMode === "track") {
            sortBtn.innerText = "Track 1–N";
            sortBtn.title = "Currently ordered by official album track sequence. Click for A–Z.";
        } else {
            sortBtn.innerText = "A–Z";
            sortBtn.title = "Currently ordered alphabetically. Click for Track sequence.";
        }
    }
}

function setupAlbumFilter() {
    const filterSelect = document.getElementById("album-filter");
    const sortBtn = document.getElementById("album-sort-btn");
    if (!filterSelect) return;

    filterSelect.innerHTML = `<option value="all">All Songs</option>`;

    albumDatabase.forEach(album => {
        const opt = document.createElement("option");
        opt.value = album.album_id;
        const yearStr = album.release_year ? ` (${album.release_year})` : '';
        const isSpecial = !album.release_year;
        opt.innerText = isSpecial ? `(${album.title})` : `${album.title}${yearStr}`;
        filterSelect.appendChild(opt);
    });

    filterSelect.onchange = (e) => {
        const val = e.target.value.toLowerCase();
        // Default to natural track order when an album is chosen
        currentAlbumSortMode = "track";
        updateSortToggleUI();
        const songsToRender = getSortedSongsForAlbum(val, currentAlbumSortMode);
        renderSongList(songsToRender);
        scrollActiveSongIntoView();
        updateViewStateUrl();
    };

    if (sortBtn) {
        sortBtn.onclick = (e) => {
            e.stopPropagation();
            currentAlbumSortMode = currentAlbumSortMode === "track" ? "alpha" : "track";
            updateSortToggleUI();
            const currentAlbum = (filterSelect.value || "all").toLowerCase();
            const songsToRender = getSortedSongsForAlbum(currentAlbum, currentAlbumSortMode);
            renderSongList(songsToRender);
            scrollActiveSongIntoView();
        };
    }
}

// Helper to convert strings to clean Title Case for standardized display
function toTitleCase(str) {
    if (!str) return "";
    return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// Helper to parse comma-separated chart filenames while preserving commas inside keys/notes (e.g. "D, capo 2.docx")
function parseChartAlternates(str) {
    if (!str || !str.trim()) return [];
    const rawParts = str.split(',').map(s => s.trim()).filter(Boolean);
    const files = [];
    let current = "";
    const extRegex = /\.(pdf|docx?|html?|txt)$/i;

    for (const part of rawParts) {
        if (!current) {
            current = part;
        } else {
            current += ", " + part;
        }
        if (extRegex.test(current)) {
            files.push(current);
            current = "";
        }
    }
    if (current) {
        files.push(current);
    }
    return files;
}

// Robust CSV parser that handles quotes and normalizes header keys
function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return [];
    
    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/[\s_-]+/g, '_'));
    
    return lines.slice(1).map(line => {
        const row = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(val => {
            let v = val.trim();
            if (v.startsWith('"') && v.endsWith('"')) {
                v = v.slice(1, -1).replace(/""/g, '"');
            }
            return v;
        });
        let obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i] || '';
        });
        rawHeaders.forEach((rh, i) => {
            obj[rh] = row[i] || '';
        });
        return obj;
    });
}

// 2. Render the master song list UI with document, lyrics, and audio indicators
function renderSongList(songs) {
    const listContainer = document.getElementById("song-list");
    listContainer.innerHTML = "";

    const filterVal = (document.getElementById("album-filter")?.value || "all").toLowerCase();
    const showAlbumSubtitle = filterVal === "all";

    songs.forEach(song => {
        const item = document.createElement("div");
        item.className = "song-item";
        const songKey = (song.song_url || song.url || "").trim().toLowerCase();
        item.dataset.songUrl = songKey;

        if (currentActiveSong) {
            const currentKey = (currentActiveSong.song_url || currentActiveSong.url || "").trim().toLowerCase();
            if (currentKey && currentKey === songKey) {
                item.classList.add("active");
            }
        }
        
        const rawTitle = song.title || song.song_title || song.canonical_title || "Untitled";
        const formattedTitle = toTitleCase(rawTitle);
        const albumName = song.album || song.source_album || song.album_name || "";
        const trackPrefix = (!showAlbumSubtitle && song.track_number) ? `<span style="color: #a1a1aa; font-variant-numeric: tabular-nums; margin-right: 6px; font-size: 0.88rem;">${song.track_number.padStart(2, '0')}.</span>` : '';
        
        // Check for chart alternates
        const alternatesStr = song.chart_alternates || "";
        const hasCharts = alternatesStr.trim() !== "";
        
        // Check for lyrics
        const hasLyrics = hasLyricsContent(song.lyrics_json);

        // Check if playable audio exists (native MP3, Bandcamp, YouTube, or Spotify)
        const hasNativeAudio = (song.audio_uri || "").trim() !== "";
        const hasBandcampAudio = (song.embed_url || song.track_id || "").trim() !== "";
        const hasYouTubeAudio = (song.youtube_id || "").trim() !== "";
        const hasSpotifyAudio = (song.spotify_id || "").trim() !== "";
        const hasPlayableAudio = hasNativeAudio || hasBandcampAudio || hasYouTubeAudio || hasSpotifyAudio;
        
        const audioIcon = hasPlayableAudio ? '<span title="Audio available" style="color: #0284c7;">♪</span>' : '';
        const chartIcon = hasCharts ? '<span title="Chart / Chords available" style="color: #71717a;">🎼</span>' : '';
        const lyricsIcon = hasLyrics ? '<span title="Lyrics available" style="color: #10b981;">📝</span>' : '';
        const albumLine = (showAlbumSubtitle && albumName) ? `<div style="color: #71717a; font-size: 0.85rem; margin-top: 3px;">- ${toTitleCase(albumName)}</div>` : '';

        item.innerHTML = `<div style="display: flex; flex-direction: column;"><div>${trackPrefix}${formattedTitle}</div>${albumLine}</div><div class="song-item-icons">${audioIcon}${chartIcon}${lyricsIcon}</div>`;
        item.onclick = () => {
            document.querySelectorAll(".song-item").forEach(el => el.classList.remove("active"));
            item.classList.add("active");
            selectSong(song, { chartIndex: 0, scrollIntoView: false });
        };
        listContainer.appendChild(item);
    });
}

// Scroll active song item into view in playlist so it's instantly centered
function scrollActiveSongIntoView(behavior = "auto") {
    const doScroll = () => {
        const activeItem = document.querySelector("#song-list .song-item.active");
        if (activeItem) {
            activeItem.scrollIntoView({ block: "center", behavior: behavior });
        }
    };
    requestAnimationFrame(doScroll);
}

// Helper to update active CSS highlight in song-list without rebuilding DOM
function updateActiveSongHighlight() {
    const listContainer = document.getElementById("song-list");
    if (!listContainer || !currentActiveSong) return;

    const currentKey = (currentActiveSong.song_url || currentActiveSong.url || "").trim().toLowerCase();
    const items = listContainer.querySelectorAll(".song-item");
    items.forEach(item => {
        if (item.dataset.songUrl && item.dataset.songUrl.toLowerCase() === currentKey) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });
}

function hasLyricsContent(lyricsJsonStr) {
    if (!lyricsJsonStr || lyricsJsonStr.trim() === "") return false;
    try {
        const parsed = JSON.parse(lyricsJsonStr);
        return parsed.stanzas && parsed.stanzas.length > 0;
    } catch (e) {
        return false;
    }
}

// Active audio source override per song session (e.g. user clicks YouTube badge when Bandcamp is default)
let currentSongAudioSource = null;

// Render multi-source audio player (Native MP3, Bandcamp, YouTube, Spotify) based on priority
function renderAudio(song, forcedSource = null) {
    const audioPlayer = document.getElementById("song-audio-player");
    const embedContainer = document.getElementById("embed-player");
    const emptyPlaceholder = document.getElementById("audio-empty-placeholder");
    const sourcesBar = document.getElementById("audio-sources-bar");
    const badgesContainer = document.getElementById("audio-source-badges");

    // Reset audio players
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = "";
        audioPlayer.style.display = "none";
    }
    if (embedContainer) {
        embedContainer.innerHTML = "";
        embedContainer.style.display = "none";
    }
    if (emptyPlaceholder) {
        emptyPlaceholder.style.display = "none";
    }
    if (sourcesBar) {
        sourcesBar.style.display = "none";
    }
    if (badgesContainer) {
        badgesContainer.innerHTML = "";
    }

    if (!song) {
        if (emptyPlaceholder) emptyPlaceholder.style.display = "flex";
        return;
    }

    const audioUrl = (song.audio_uri || "").trim();
    const embedUrl = (song.embed_url || "").trim();
    const trackId = (song.track_id || "").trim();
    const isBandcamp = Boolean(trackId || (embedUrl && embedUrl.includes("bandcamp")));
    const ytId = (song.youtube_id || "").trim();
    const spotifyId = (song.spotify_id || "").trim();

    // Determine all valid audio sources for this song
    const availableSources = [];
    if (audioUrl) availableSources.push({ id: "mp3", label: "MP3" });
    if (isBandcamp) availableSources.push({ id: "bandcamp", label: "Bandcamp" });
    if (ytId) availableSources.push({ id: "youtube", label: "YouTube" });
    if (spotifyId) availableSources.push({ id: "spotify", label: "Spotify" });

    if (availableSources.length === 0) {
        if (emptyPlaceholder) emptyPlaceholder.style.display = "flex";
        return;
    }

    const userPref = getUserStreamPreference(); // 'youtube' or 'spotify'

    // Determine active source:
    // 1. If forced/chosen by user clicking a badge:
    let activeSourceId = forcedSource;

    // 2. Otherwise default priority:
    if (!activeSourceId || !availableSources.some(s => s.id === activeSourceId)) {
        if (audioUrl) {
            activeSourceId = "mp3";
        } else if (isBandcamp) {
            activeSourceId = "bandcamp";
        } else if (userPref === "spotify" && spotifyId) {
            activeSourceId = "spotify";
        } else if (userPref === "youtube" && ytId) {
            activeSourceId = "youtube";
        } else if (ytId) {
            activeSourceId = "youtube";
        } else if (spotifyId) {
            activeSourceId = "spotify";
        } else {
            activeSourceId = availableSources[0].id;
        }
    }
    currentSongAudioSource = activeSourceId;

    // Render the player for the chosen source
    if (activeSourceId === "mp3" && audioUrl) {
        audioPlayer.src = audioUrl;
        audioPlayer.style.display = "block";
        audioPlayer.load();
    } else if (activeSourceId === "bandcamp" && isBandcamp) {
        const finalEmbedUrl = embedUrl || `https://bandcamp.com/EmbeddedPlayer/album=${song.bandcamp_album_id || song.album_id}/size=large/bgcol=ffffff/linkcol=0284c7/tracklist=false/artwork=small/track=${song.track_id}/transparent=true/`;
        embedContainer.innerHTML = `<iframe src="${finalEmbedUrl}" seamless title="Track Player"></iframe>`;
        embedContainer.style.display = "block";
    } else if (activeSourceId === "youtube" && ytId) {
        embedContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}?rel=0&playsinline=1" title="YouTube Track Player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
        embedContainer.style.display = "block";
    } else if (activeSourceId === "spotify" && spotifyId) {
        embedContainer.innerHTML = `<iframe src="https://open.spotify.com/embed/track/${spotifyId}?utm_source=generator&theme=0" title="Spotify Track Player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
        embedContainer.style.display = "block";
    }

    // Render source switcher badges if multiple sources exist
    if (availableSources.length > 1 && sourcesBar && badgesContainer) {
        sourcesBar.style.display = "flex";
        availableSources.forEach(src => {
            const badge = document.createElement("button");
            badge.type = "button";
            badge.className = `audio-source-badge ${src.id === activeSourceId ? "active" : ""}`;
            badge.innerText = src.label;
            badge.title = `Switch audio playback to ${src.label}`;
            badge.onclick = (e) => {
                e.stopPropagation();
                if (src.id !== activeSourceId) {
                    renderAudio(song, src.id);
                }
            };
            badgesContainer.appendChild(badge);
        });
    }
}

// 3. Handle song selection, populate alternates, audio player, chords, and lyrics
function selectSong(song, options = {}) {
    currentActiveSong = song;
    updateActiveSongHighlight();
    const requestedChartIndex = typeof options.chartIndex === "number" ? options.chartIndex : 0;
    currentChartIndex = requestedChartIndex;

    // Reset mobile view mode back to Both on every song selection
    setMobilePaneMode("both");

    const title = toTitleCase(song.title || song.song_title || song.canonical_title || "Untitled");
    const dateStr = (song.composition_date || "").trim();

    // Display: <TITLE> <album> (<composition date>)
    const titleElem = document.getElementById("active-song-title");
    const albumName = song.album || song.source_album || song.album_name || "";
    const formattedAlbum = albumName ? toTitleCase(albumName) : "";

    let albumHtml = formattedAlbum ? `<span class="song-meta-subtitle">${escapeHtml(formattedAlbum)}</span>` : "";
    let dateHtml = dateStr ? `<span class="song-meta-subtitle">(${escapeHtml(dateStr)})</span>` : "";

    const parts = [`<span class="song-meta-title">${escapeHtml(title)}</span>`, albumHtml, dateHtml].filter(Boolean);
    titleElem.innerHTML = parts.join(" ");

    // Update feedback mailto link
    const feedbackBtn = document.getElementById("feedback-btn");
    if (feedbackBtn) {
        const subject = encodeURIComponent(`Brad Yoder Chart App: ${title}`);
        const body = encodeURIComponent(
            `Hi Matthew,\n\nNotes / edits for "${title}":\n\n- Chords / Chart:\n\n- Lyrics:\n\n- Audio / Other:\n\n(Attach any .docx or .pdf files directly to this email)`
        );
        feedbackBtn.href = `mailto:matthew.siegler@gmail.com?subject=${subject}&body=${body}`;
    }

    // --- AUDIO PLAYER HANDLING (Always paused on selection/load) ---
    renderAudio(song);

    // --- CHART ALTERNATES & CHORDS (LEFT PANE) ---
    const alternatesStr = song.chart_alternates || "";
    const files = parseChartAlternates(alternatesStr);

    // Update Left Pane Header: tuning/capo value
    const tuningMetaElem = document.getElementById("chart-tuning-meta");
    const tuningVal = (song.tuning_capo || "").trim();
    if (tuningMetaElem) {
        if (tuningVal) {
            tuningMetaElem.innerText = tuningVal;
        } else {
            tuningMetaElem.innerText = "";
        }
    }

    const selectorContainer = document.getElementById("version-selector");
    const dropdownContainer = document.getElementById("version-select-dropdown");
    if (selectorContainer) selectorContainer.innerHTML = "";
    if (dropdownContainer) dropdownContainer.innerHTML = "";

    // Determine target chart file index
    let activeFileIndex = 0;
    if (files.length > 0) {
        if (requestedChartIndex >= 0 && requestedChartIndex < files.length) {
            activeFileIndex = requestedChartIndex;
        }
    }
    currentChartIndex = activeFileIndex;

    if (files.length > 1) {
        if (selectorContainer) selectorContainer.style.display = "flex";
        if (dropdownContainer) dropdownContainer.style.display = "";

        files.forEach((file, index) => {
            const fileExt = file.split('.').pop().toLowerCase();
            const stem = file.replace(/\.[^.]+$/, '');
            const dashParts = stem.split(/[-_]{1,2}/);
            const suffix = dashParts.length > 1 ? dashParts[dashParts.length - 1].trim() : `Version ${index + 1}`;
            const labelText = `${suffix} (${fileExt})`;

            // Desktop tab button
            if (selectorContainer) {
                const btn = document.createElement("button");
                btn.innerText = labelText;
                if (index === activeFileIndex) btn.classList.add("active");

                btn.onclick = () => {
                    selectorContainer.querySelectorAll("button").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    if (dropdownContainer) dropdownContainer.value = index;
                    currentChartIndex = index;
                    updateViewStateUrl();
                    loadChartFile(file);
                };
                selectorContainer.appendChild(btn);
            }

            // Mobile dropdown option
            if (dropdownContainer) {
                const opt = document.createElement("option");
                opt.value = index;
                opt.innerText = labelText;
                if (index === activeFileIndex) opt.selected = true;
                dropdownContainer.appendChild(opt);
            }
        });

        if (dropdownContainer) {
            dropdownContainer.onchange = (e) => {
                const selectedIdx = parseInt(e.target.value, 10);
                if (selectorContainer) {
                    const buttons = selectorContainer.querySelectorAll("button");
                    buttons.forEach((b, i) => {
                        if (i === selectedIdx) b.classList.add("active");
                        else b.classList.remove("active");
                    });
                }
                currentChartIndex = selectedIdx;
                updateViewStateUrl();
                loadChartFile(files[selectedIdx]);
            };
        }
    } else {
        if (selectorContainer) selectorContainer.style.display = "none";
        if (dropdownContainer) dropdownContainer.style.display = "none";
    }

    if (files.length > 0) {
        loadChartFile(files[activeFileIndex]);
    } else {
        const tuningStr = (song.tuning_capo || "").trim();
        const notesStr = (song.notes || "").trim();
        const dateStr = (song.composition_date || "").trim();
        const albumName = song.album || song.source_album || "";

        let referenceCardHtml = `
            <div class="chart-reference-card">
                <div class="chart-reference-header">
                    <span class="chart-reference-badge">Musician Reference</span>
                    <span style="font-size: 0.85rem; color: #71717a;">Lead Sheet Pending</span>
                </div>
                ${tuningStr ? `
                <div class="chart-reference-item">
                    <span class="chart-reference-label">Tuning / Capo:</span>
                    <span class="chart-reference-val" style="color: #0284c7; font-weight: 600;">${escapeHtml(tuningStr)}</span>
                </div>` : ''}
                ${albumName ? `
                <div class="chart-reference-item">
                    <span class="chart-reference-label">Album / Release:</span>
                    <span class="chart-reference-val">${escapeHtml(toTitleCase(albumName))}</span>
                </div>` : ''}
                ${dateStr ? `
                <div class="chart-reference-item">
                    <span class="chart-reference-label">Written:</span>
                    <span class="chart-reference-val">${escapeHtml(dateStr)}</span>
                </div>` : ''}
                ${notesStr ? `
                <div class="chart-reference-item" style="margin-top: 14px;">
                    <span class="chart-reference-label">Brad's Notes:</span>
                    <span class="chart-reference-val" style="font-style: italic; color: #52525b;">${escapeHtml(notesStr)}</span>
                </div>` : ''}
            </div>
        `;
        document.getElementById("chart-container").innerHTML = referenceCardHtml;
    }

    // --- LYRICS (RIGHT PANE) ---
    renderLyrics(song);

    // Scroll active item into view in playlist if requested
    if (options.scrollIntoView !== false) {
        scrollActiveSongIntoView();
    }

    // Sync URL query state unless we are restoring state
    if (!options.skipUrlSync) {
        updateViewStateUrl({ replace: options.replaceUrl });
    }
}

// Render lyrics and notes inside the right pane
function renderLyrics(song) {
    const container = document.getElementById("lyrics-container");
    container.innerHTML = "";

    let hasLyrics = false;
    let stanzas = [];

    if (song.lyrics_json) {
        try {
            const parsed = JSON.parse(song.lyrics_json);
            if (parsed && parsed.stanzas && parsed.stanzas.length > 0) {
                stanzas = parsed.stanzas;
                hasLyrics = true;
            }
        } catch (e) {
            console.warn("Could not parse lyrics_json:", e);
        }
    }

    // Composition notes placed at the bottom of lyrics
    let notesHtml = "";
    const notesStr = (song.notes || "").trim();
    if (notesStr) {
        notesHtml = `
            <div class="song-notes-divider"></div>
            <div class="song-notes-box"><strong>Notes:</strong> ${escapeHtml(notesStr)}</div>
        `;
    }

    // Provenance Footer Pill for Lyrics
    const songUrl = song.url || "";
    let lyricsProvenanceHtml = "";
    if (songUrl && songUrl.includes("bradyoder.com/songs/")) {
        const pathPart = songUrl.replace("https://bradyoder.com", "").replace("http://bradyoder.com", "");
        lyricsProvenanceHtml = `
            <div class="provenance-footer">
                <a href="${escapeHtml(songUrl)}" target="_blank" rel="noopener noreferrer" class="provenance-pill" title="View canonical song page on bradyoder.com">
                    <span class="pill-label">Source</span>
                    <span>🌐 bradyoder.com${escapeHtml(pathPart)}</span>
                </a>
            </div>
        `;
    } else if (song.album_id === "unreleased-charts") {
        lyricsProvenanceHtml = `
            <div class="provenance-footer">
                <span class="provenance-pill">
                    <span class="pill-label">Source</span>
                    <span>📝 Brad's Unreleased Songbook Binder</span>
                </span>
            </div>
        `;
    }

    if (hasLyrics) {
        let lyricsHtml = `<div class="lyrics-container">`;

        stanzas.forEach(stanza => {
            const typeClass = (stanza.type || "verse").toLowerCase();
            const labelText = stanza.label || (stanza.type ? toTitleCase(stanza.type) : "");
            const linesHtml = (stanza.lines || []).map(line => `<p class="stanza-line">${escapeHtml(line) || '&nbsp;'}</p>`).join("");

            lyricsHtml += `
                <div class="stanza ${typeClass}">
                    ${labelText ? `<div class="stanza-label">${escapeHtml(labelText)}</div>` : ''}
                    ${linesHtml}
                </div>
            `;
        });

        // Append composition notes and provenance pill to bottom of lyrics
        lyricsHtml += `${notesHtml}${lyricsProvenanceHtml}</div>`;
        container.innerHTML = lyricsHtml;
    } else {
        const isInstrumentalOrRehearsal = (song.album_id === "unreleased-charts") || 
            (song.title && (song.title.toLowerCase().includes("(instr") || song.title.toLowerCase().includes("instrumental")));
        
        let emptyMessageHtml = "";
        if (isInstrumentalOrRehearsal) {
            emptyMessageHtml = `
                <div class="chart-reference-card" style="margin-top: 10px;">
                    <div class="chart-reference-header">
                        <span class="chart-reference-badge" style="background: #f4f4f5; color: #52525b;">Rehearsal Lead Sheet</span>
                        <span style="font-size: 0.85rem; color: #71717a;">Instrumental / Chords</span>
                    </div>
                    <div style="font-size: 0.9rem; color: #52525b; line-height: 1.5; margin-top: 10px;">
                        This piece is an instrumental or chord arrangement from Brad's archives. Consult the chart in the left pane for musical form, progression, and key.
                    </div>
                </div>
            `;
        } else {
            emptyMessageHtml = `<p style="color: #71717a; margin-bottom: 16px;">No lyric transcript available for this song.</p>`;
        }

        container.innerHTML = `
            ${emptyMessageHtml}
            ${notesHtml}
            ${lyricsProvenanceHtml}
        `;
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper to fetch file with fallback locations and filename variants
async function fetchChartBuffer(filename) {
    const nameCandidates = [filename];
    if (filename.includes('--')) {
        nameCandidates.push(filename.replace(/--+/g, '-'));
    } else if (filename.includes('-')) {
        nameCandidates.push(filename.replace(/-/g, '--'));
    }
    if (filename.toLowerCase().endsWith('.doc')) {
        nameCandidates.push(filename + 'x');
    }

    const candidatePaths = [];
    for (const name of nameCandidates) {
        candidatePaths.push(
            `./charts/input/${name}`,
            `./charts/output/${name}`,
            `./charts/${name}`,
            `./${name}`
        );
    }

    for (const path of candidatePaths) {
        try {
            const res = await fetch(path);
            if (res.ok) {
                const buffer = await res.arrayBuffer();
                return { ok: true, buffer, path };
            }
        } catch (e) {
            // continue to next path candidate
        }
    }
    return { ok: false };
}

// Normalize Mammoth HTML output by properly resolving Word superscript/subscript formatting artifacts.
// In MS Word, Brad writes flats as root letter + superscript 'b' (e.g. B<sup>b</sup>),
// sharps as root + superscript '#' (F<sup>#</sup>), slash chords as <sup>Eb/</sup>Bb or <sup>B</sup><sup>b/</sup>D,
// and chord qualities/extensions as <sup>9</sup>, <sup>maj7</sup>, <sup>sus</sup>.
// This function collapses accidentals onto their roots while preserving typographic sup/sub tags
// for musical extensions so they can be toggled via Fancy Formatting mode (¶).
function cleanMammothDocxHtml(html) {
    if (!html) return html;
    
    // 0. Trim whitespace inside sup / sub tags and clean empty tags:
    let h = html.replace(/<sup[^>]*>\s*/gi, '<sup>').replace(/\s*<\/sup>/gi, '</sup>');
    h = h.replace(/<sub[^>]*>\s*/gi, '<sub>').replace(/\s*<\/sub>/gi, '</sub>');
    h = h.replace(/<sup>\s*<\/sup>/gi, '');
    h = h.replace(/<sub>\s*<\/sub>/gi, '');

    // 1. Merge adjacent sup/sub tags: <sup>X</sup><sup>Y</sup> -> <sup>XY</sup>
    h = h.replace(/<\/sup>\s*<sup>/g, '');
    h = h.replace(/<\/sub>\s*<sub>/g, '');
    
    // 2. Attach superscript accidentals (b, #) to the preceding musical root letter:
    // e.g. B<sup>b</sup> -> Bb, B<sup>b/</sup> -> Bb/, F<sup>#</sup> -> F#
    h = h.replace(/([A-Ga-g])\s*<sup>\s*b\s*<\/sup>/gi, '$1b');
    h = h.replace(/([A-Ga-g])\s*<sup>\s*#\s*<\/sup>/g, '$1#');
    h = h.replace(/([A-Ga-g])\s*<sup>\s*b([/a-zA-Z0-9_#+-]*)\s*<\/sup>/gi, '$1b$2');
    h = h.replace(/([A-Ga-g])\s*<sup>\s*#([/a-zA-Z0-9_#+-]*)\s*<\/sup>/g, '$1#$2');
    
    // 3. Move trailing slashes outside <sup>: e.g. <sup>7/</sup> -> <sup>7</sup>/, <sup>/</sup> -> /
    h = h.replace(/<sup>([^<]*)\/<\/sup>/g, (m, inner) => inner ? `<sup>${inner}</sup>/` : '/');

    // 4. Unwrap chord roots mistakenly enclosed in <sup>:
    // In MS Word, Brad frequently formatted whole chords or roots as superscript (e.g. <sup>C</sup>/G, <sup>Cmaj7</sup>/G, <sup>Am</sup>/D, <sup>Fadd9/</sup>A).
    // We unwrap the musical root note onto the standard baseline so that roots stay full-size:
    h = h.replace(/<sup>\s*([A-Ga-g][#b]?)([^<]*)<\/sup>/g, (m, root, rest) => {
        if (rest) {
            if (rest.endsWith('/')) {
                const inner = rest.slice(0, -1);
                return inner ? `${root}<sup>${inner}</sup>/` : `${root}/`;
            }
            return `${root}<sup>${rest}</sup>`;
        }
        return root;
    });

    // 5. Unwrap subscript bass notes (e.g. <sub>Eb</sub> -> Eb)
    h = h.replace(/<sub>\s*([A-Ga-g][#b]?)\s*<\/sub>/gi, '$1');

    // 6. Unwrap standalone <sup>add...</sup> onto baseline (e.g. C<sup>add9</sup> -> Cadd9)
    h = h.replace(/<sup>\s*(add[0-9a-zA-Z#b+-]*)\s*<\/sup>/gi, ' $1');

    // 7. Attach standalone superscript slashes: e.g. <sup>/</sup>C -> /C
    h = h.replace(/<sup>\s*\/\s*<\/sup>\s*([A-Ga-g][#b]?)/g, '/$1');
    h = h.replace(/<sup>\s*\/\s*<\/sup>/g, '/');
    
    // 8. Normalize accidental spaces inside chords: e.g. "B  b" -> "Bb", "F  #" -> "F#"
    h = h.replace(/\b([A-Ga-g])\s+([b#])\b/g, '$1$2');
    
    // 9. Smush unsmushed chord extensions separated by spaces:
    // e.g. "C maj7" -> "Cmaj7", "Bb add9maj7" -> "Bbadd9maj7", "Am add9" -> "Amadd9", "Bb 69" -> "Bb69", "G sus" -> "Gsus"
    const smushPattern = /\b([A-Ga-g][#b]?m?)\s+((?:maj|min|dim|aug|sus|add|m7|m9|m11|[0-9])[a-zA-Z0-9#b+-]*)/gi;
    let prev = null;
    while (prev !== h) {
        prev = h;
        h = h.replace(smushPattern, '$1$2');
    }
    
    // 10. Strip redundant top header line if it repeats the song title / Brad Yoder / tuning
    // e.g. <p>AGAIN -- brad yoder (D, G capo 7)</p>, <p>earring -- brad yoder E (Ab capo 9)</p>,
    // <p>em/G (am/C, capo 7)</p>, <p>ONE EXCUSE - brad yoder (G, D capo 5)</p>
    h = h.replace(/^\s*<p[^>]*>(?:.*?(?:brad\s+yoder|capo|[A-Ga-g][#b♯♭]?\s*\(.*?\)).*?)<\/p>\s*/i, '');

    return h;
}

// Format chord extensions (e.g. m, maj7, 7, (add9), sus):
// In fancy mode:
// - 'add' chords are formatted with parentheses on the baseline: C(add9), G(add9), Aᵐ(add9), F(add9)/ₐ
// - qualities like 'm', 'maj7', '7', 'sus' sit in superscript: Bᵐ, Cᵐᵃʲ⁷, Gˢᵘˢ
// In plain mode:
// - flattens cleanly: C(add9), Am(add9), Bm, Cmaj7
function formatChordExtensionHtml(finalExt, isFancy) {
    if (!finalExt) return '';
    const addMatch = finalExt.match(/^(m|maj|dim|aug|sus|[0-9]+)?\(?add([0-9a-zA-Z♯♭+-]*)\)?(.*)$/i);
    if (addMatch) {
        const prefix = addMatch[1] || '';
        const addNum = addMatch[2] || '';
        const suffix = addMatch[3] || '';
        const addToken = `(add${addNum})`;
        if (isFancy) {
            const prefixHtml = prefix ? `<sup>${prefix}</sup>` : '';
            const suffixHtml = suffix ? `<sup>${suffix}</sup>` : '';
            return `${prefixHtml}${addToken}${suffixHtml}`;
        } else {
            return `${prefix}${addToken}${suffix}`;
        }
    }
    return isFancy ? `<sup>${finalExt}</sup>` : finalExt;
}

// Format chords for display:
// In Fancy mode ([¶] ON):
// 1. Root stays full-size on the baseline (e.g. B, G, A, F♯).
// 2. Extensions / minor qualities sit in superscript (e.g. B<sup>m</sup>, B<sup>m7</sup>, F♯<sup>msus</sup>, G<sup>maj7</sup>).
//    Chords with 'add' (like Cadd9, Fadd9) format with parentheses on the baseline: C(add9), F(add9)/<sub>A</sub>, A<sup>m</sup>(add9).
// 3. Slash bass notes sit in subscript (e.g. B<sup>m</sup>/<sub>A</sub>, G/<sub>D</sub>, A/<sub>C♯</sub>, /<sub>F♯</sub>).
// In Plain mode ([¶] OFF):
// Everything flattens to clean single-line ASCII text (e.g. Bm/A, G/D, A/C#, F#msus, C(add9)).
function formatChordTokenHtml(root, qualityAndExt, bass, bassExt, isFancy) {
    if (!root) return '';
    const capRoot = root.charAt(0).toUpperCase() + root.slice(1);
    const finalRoot = isFancy ? capRoot.replace(/#/g, '♯').replace(/b/g, '♭') : capRoot.replace(/♯/g, '#').replace(/♭/g, 'b');

    // Clean any existing HTML tags from Mammoth (e.g. <sup>9</sup>)
    const cleanExt = (qualityAndExt || '').replace(/<\/?(?:sup|sub)>/gi, '');
    let finalExt = isFancy ? cleanExt.replace(/#/g, '♯').replace(/b/g, '♭') : cleanExt.replace(/♯/g, '#').replace(/♭/g, 'b');

    const extHtml = formatChordExtensionHtml(finalExt, isFancy);

    let bassHtml = '';
    if (bass) {
        const capBass = bass.charAt(0).toUpperCase() + bass.slice(1);
        const bExt = (bassExt || '').replace(/<\/?(?:sup|sub)>/gi, '');
        const finalBass = isFancy ? (capBass + bExt).replace(/#/g, '♯').replace(/b/g, '♭') : (capBass + bExt).replace(/♯/g, '#').replace(/♭/g, 'b');
        bassHtml = isFancy ? `/<sub>${finalBass}</sub>` : `/${finalBass}`;
    }

    return `${finalRoot}${extHtml}${bassHtml}`;
}

function formatChordsFancy(html) {
    if (!html) return html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const container = doc.body.firstElementChild;
    if (!container) return html;

    const paragraphs = container.querySelectorAll('p, tr');
    paragraphs.forEach(p => {
        const text = p.textContent || "";
        if (text.includes('|') || text.includes('||:') || text.includes(':||')) {
            p.innerHTML = p.innerHTML.replace(CHORD_TOKEN_REGEX, (match, soloSlash, root, qualityAndExt, bass, bassExt) => {
                if (soloSlash) {
                    const pitch = soloSlash.slice(1);
                    const capPitch = pitch.charAt(0).toUpperCase() + pitch.slice(1).replace(/#/g, '♯').replace(/b/g, '♭');
                    return isFancyFormattingMode ? `/<sub>${capPitch}</sub>` : `/${capPitch}`;
                }
                return formatChordTokenHtml(root, qualityAndExt, bass, bassExt, isFancyFormattingMode);
            });
        } else if (text.includes('capo') || (text.includes('(') && text.includes(')'))) {
            p.innerHTML = p.innerHTML.replace(/\(([^)]+)\)/g, (parenMatch, innerContent) => {
                const formattedInner = innerContent.replace(CHORD_TOKEN_REGEX, (match, soloSlash, root, qualityAndExt, bass, bassExt) => {
                    if (soloSlash) {
                        const pitch = soloSlash.slice(1);
                        const capPitch = pitch.charAt(0).toUpperCase() + pitch.slice(1).replace(/#/g, '♯').replace(/b/g, '♭');
                        return isFancyFormattingMode ? `/<sub>${capPitch}</sub>` : `/${capPitch}`;
                    }
                    return formatChordTokenHtml(root, qualityAndExt, bass, bassExt, isFancyFormattingMode);
                });
                return `(${formattedInner})`;
            });
        }
    });

    return container.innerHTML;
}

// Convert chord accidentals (# and b) to authentic musical typographic glyphs (♯ and ♭)
function applyMusicalAccidentalGlyphs(html) {
    if (!html) return html;
    let h = html;
    h = h.replace(/(?<=\/[A-Ga-g])#/g, '♯');
    h = h.replace(/\b([A-Ga-g])#/g, '$1♯');
    h = h.replace(/\b([A-Ga-g])b(?=[0-9/m\s:\|,\(\)\-\.<>]|$)/g, '$1♭');
    h = h.replace(/(?<=\/[A-Ga-g])b(?=[0-9/m\s:\|,\(\)\-\.<>]|$)/g, '♭');
    return h;
}

// Revert musical accidental glyphs (♯ and ♭) to standard ASCII (# and b)
function revertToAsciiAccidentals(html) {
    if (!html) return html;
    return html.replace(/♯/g, '#').replace(/♭/g, 'b');
}
let currentTransposeSemitones = 0;
let rawCurrentDocxHtml = null;
let currentAccidentalMode = 'auto'; // 'auto', 'sharp', 'flat'
let isFancyFormattingMode = true; // Toggle for superscript/subscript visual styling (¶)

// Pitch transposition data structures
const PITCH_SEMITONE_MAP = {
    'C': 0, 'B#': 0, 'B♯': 0,
    'C#': 1, 'C♯': 1, 'Db': 1, 'D♭': 1,
    'D': 2,
    'D#': 3, 'D♯': 3, 'Eb': 3, 'E♭': 3,
    'E': 4, 'Fb': 4, 'F♭': 4,
    'F': 5, 'E#': 5, 'E♯': 5,
    'F#': 6, 'F♯': 6, 'Gb': 6, 'G♭': 6,
    'G': 7,
    'G#': 8, 'G♯': 8, 'Ab': 8, 'A♭': 8,
    'A': 9,
    'A#': 10, 'A♯': 10, 'Bb': 10, 'B♭': 10,
    'B': 11, 'Cb': 11, 'C♭': 11
};
// Scales with authentic musical glyphs: Sharp ♯ (U+266F) and Flat ♭ (U+266D)
const SHARP_SCALE_FANCY = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_SCALE_FANCY  = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// Scales with standard ASCII characters: Sharp # and Flat b
const SHARP_SCALE_ASCII = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SCALE_ASCII  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function transposePitchString(pitch, semitones, preferFlat = false) {
    if (!pitch) return pitch;
    const isLower = pitch === pitch.toLowerCase();
    // Normalize pitch casing e.g. "f#" -> "F#", "f♯" -> "F♯", "eb" -> "Eb", "e♭" -> "E♭", "b" -> "B"
    let norm = pitch.charAt(0).toUpperCase();
    if (pitch.length > 1) {
        norm += pitch.slice(1).replace(/b/g, 'b');
    }
    if (!(norm in PITCH_SEMITONE_MAP)) return pitch;
    let semitoneVal = (PITCH_SEMITONE_MAP[norm] + semitones) % 12;
    if (semitoneVal < 0) semitoneVal += 12;
    let scale;
    if (isFancyFormattingMode) {
        scale = preferFlat ? FLAT_SCALE_FANCY : SHARP_SCALE_FANCY;
    } else {
        scale = preferFlat ? FLAT_SCALE_ASCII : SHARP_SCALE_ASCII;
    }
    const transposed = scale[semitoneVal];
    if (isFancyFormattingMode) {
        return transposed;
    }
    return isLower ? transposed.toLowerCase() : transposed;
}

// Regex matching individual chords and slash bass tokens across all Brad Yoder charts
// Handles standard ASCII (#, b) and Unicode musical accidentals (♯, ♭):
// Handles: G, f#m, f#msus, F#7/A#, bm, /C#, /A, B579, Gadd9, C/E, D♭, E♭, dm11, Em9-5, Gmaj7+11, Am#6, Dsus79, Emb5, G/Bo, Bbadd9maj7,
// and supports inner HTML tags like dm<sup>9</sup> or F<sup>maj7</sup> in fancy mode,
// as well as parenthesized add extensions like C(add9) or G(+11).
const CHORD_TOKEN_REGEX = /(?<![A-Za-z0-9_#♯*])(?:(\/[A-Ga-g][#b♯♭]?)|([A-Ga-g][#b♯♭]?)((?:<[^>]+>|\([+0-9a-zA-Z#b♯♭-]+\)|maj|min|dim|aug|sus|add|m|[0-9#b♯♭+-])*)(?:\/([A-Ga-g][#b♯♭]?)([0-9a-z#b♯♭+-]*)?)?)(?![A-Za-z0-9_#♯])/g;

function transposeChordString(text, semitones, preferFlat = false) {
    if (semitones === 0) return text;
    return text.replace(CHORD_TOKEN_REGEX, (match, soloSlash, root, qualityAndExt, bass, bassExt) => {
        if (soloSlash) {
            const pitch = soloSlash.slice(1);
            const capPitch = transposePitchString(pitch, semitones, preferFlat);
            const finalPitch = isFancyFormattingMode ? `/<sub>${capPitch}</sub>` : `/${capPitch}`;
            return `<span class="docx-chord-transposed">${finalPitch}</span>`;
        }
        if (!root) return match;
        const newRoot = transposePitchString(root, semitones, preferFlat);

        // Quality and extensions (m, maj7, (add9), sus, etc.)
        const cleanExt = (qualityAndExt || '').replace(/<\/?(?:sup|sub)>/gi, '');
        let finalExt = isFancyFormattingMode ? cleanExt.replace(/#/g, '♯').replace(/b/g, '♭') : cleanExt.replace(/♯/g, '#').replace(/♭/g, 'b');
        const extHtml = formatChordExtensionHtml(finalExt, isFancyFormattingMode);

        // Bass note: subscript in fancy mode
        let bassHtml = '';
        if (bass) {
            const capBass = transposePitchString(bass, semitones, preferFlat);
            const bExt = (bassExt || '').replace(/<\/?(?:sup|sub)>/gi, '');
            const finalExt = isFancyFormattingMode ? bExt.replace(/#/g, '♯').replace(/b/g, '♭') : bExt.replace(/♯/g, '#').replace(/♭/g, 'b');
            bassHtml = isFancyFormattingMode ? `/<sub>${capBass}${finalExt}</sub>` : `/${capBass}${finalExt}`;
        }

        return `<span class="docx-chord-transposed">${newRoot}${extHtml}${bassHtml}</span>`;
    });
}

function transposeChartHtml(html, semitones) {
    if (!html) return html;

    // Decide flat vs sharp preference based on accidentalMode toggle or transposition direction
    let preferFlat = false;
    if (currentAccidentalMode === 'flat') {
        preferFlat = true;
    } else if (currentAccidentalMode === 'sharp') {
        preferFlat = false;
    } else {
        // 'auto' mode: default to flat when transposing downward, sharp when upward
        preferFlat = semitones < 0;
    }

    // Use DOMParser to process paragraph by paragraph without corrupting HTML tags
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const container = doc.body.firstElementChild;
    if (!container) return html;

    const paragraphs = container.querySelectorAll('p, tr');
    paragraphs.forEach(p => {
        const text = p.textContent || "";
        // Transpose if line contains measure bars (|) or chord indicators
        if (text.includes('|') || text.includes('||:') || text.includes(':||')) {
            // Chord measure line
            p.innerHTML = transposeChordString(p.innerHTML, semitones, preferFlat);
        } else if (text.includes('capo') || (text.includes('(') && text.includes(')'))) {
            // Header line with key metadata like "(D, C capo 2)" or "(Eb=C capo3)"
            p.innerHTML = p.innerHTML.replace(/\(([^)]+)\)/g, (parenMatch, innerContent) => {
                const transposedInner = transposeChordString(innerContent, semitones, preferFlat);
                return `(${transposedInner})`;
            });
        }
    });

    return container.innerHTML;
}

function updateTransposeUI() {
    const controls = document.getElementById("transpose-controls");
    const label = document.getElementById("transpose-semitones");
    const accidentalBtn = document.getElementById("transpose-accidental-btn");
    const fancyBtn = document.getElementById("transpose-fancy-btn");
    if (!controls || !label) return;

    if (!rawCurrentDocxHtml) {
        controls.style.display = "none";
        return;
    }

    controls.style.display = "inline-flex";
    if (currentTransposeSemitones === 0) {
        label.innerText = "Orig";
        label.classList.remove("active");
        label.title = "Original key (click to reset)";
    } else {
        const sign = currentTransposeSemitones > 0 ? `+${currentTransposeSemitones}` : `${currentTransposeSemitones}`;
        label.innerText = sign;
        label.classList.add("active");
        label.title = `Transposed ${sign} semitones (click to reset to original)`;
    }

    if (accidentalBtn) {
        if (currentTransposeSemitones === 0) {
            accidentalBtn.style.visibility = "hidden";
            accidentalBtn.style.pointerEvents = "none";
        } else {
            accidentalBtn.style.visibility = "visible";
            accidentalBtn.style.pointerEvents = "auto";
        }

        if (currentAccidentalMode === 'sharp') {
            accidentalBtn.innerText = "♯";
            accidentalBtn.title = "Spelling: Sharps (click for Flats ♭)";
            accidentalBtn.style.color = "#0284c7";
        } else if (currentAccidentalMode === 'flat') {
            accidentalBtn.innerText = "♭";
            accidentalBtn.title = "Spelling: Flats (click for Auto)";
            accidentalBtn.style.color = "#0284c7";
        } else {
            accidentalBtn.innerText = "♯/♭";
            accidentalBtn.title = "Spelling: Auto (click for Sharps ♯)";
            accidentalBtn.style.color = "#71717a";
        }
    }

    if (fancyBtn) {
        if (isFancyFormattingMode) {
            fancyBtn.classList.add("active");
            fancyBtn.title = "Fancy formatting: ON (superscripts/subscripts active). Click to flatten.";
        } else {
            fancyBtn.classList.remove("active");
            fancyBtn.title = "Fancy formatting: OFF (flattened baseline). Click for fancy.";
        }
    }
}

// Generate the top tuning/capo banner for the chart with dynamic Capo fret shifting
function getTuningBannerHtml(semitones) {
    if (!currentActiveSong) return '';
    const rawTuning = (currentActiveSong.tuning_capo || '').trim();
    if (!rawTuning) return '';

    let preferFlat = false;
    if (currentAccidentalMode === 'flat') {
        preferFlat = true;
    } else if (currentAccidentalMode === 'sharp') {
        preferFlat = false;
    } else {
        preferFlat = semitones < 0;
    }

    let displayTuning = rawTuning;

    if (semitones === 0) {
        if (isFancyFormattingMode) {
            displayTuning = applyMusicalAccidentalGlyphs(displayTuning);
        } else {
            displayTuning = revertToAsciiAccidentals(displayTuning);
        }
    } else {
        // 1. Transpose the root sounding key (first pitch at beginning of string)
        displayTuning = displayTuning.replace(/^\s*([A-Ga-g][#b♯♭]?(?:\/[A-Ga-g][#b♯♭]?)?)/, (m, fullKey) => {
            if (fullKey.includes('/')) {
                const parts = fullKey.split('/');
                return transposePitchString(parts[0], semitones, preferFlat) + '/' + transposePitchString(parts[1], semitones, preferFlat);
            }
            return transposePitchString(fullKey, semitones, preferFlat);
        });

        // 2. Dynamically calculate the new Capo fret position:
        // By shifting the capo fret by +semitones, the guitarist maintains the exact same hand shapes!
        // E.g. "D (G/Em, capo 7)" + 1 -> "D♯ (G/Em, capo 8)"
        // "D (G/Em, capo 7)" - 2 -> "C (G/Em, capo 5)"
        // "D (G/Em, capo 7)" - 7 -> "G (G/Em, open (no capo))"
        const capoRegex = /\bcapo\s*(\d+)(!?)/i;
        const capoMatch = displayTuning.match(capoRegex);
        if (capoMatch) {
            const origFret = parseInt(capoMatch[1], 10);
            const bang = capoMatch[2] || '';
            const newFret = origFret + semitones;
            let newCapoStr;
            if (newFret === 0) {
                newCapoStr = 'open (no capo)';
            } else if (newFret > 0) {
                newCapoStr = `capo ${newFret}${bang}`;
            } else {
                // When new fret is negative, wrap around 12 frets (e.g. fret -2 -> fret 10)
                const wrappedFret = ((newFret % 12) + 12) % 12;
                newCapoStr = `capo ${wrappedFret}${bang}`;
            }
            displayTuning = displayTuning.replace(capoRegex, newCapoStr);
        }

        // Apply accidental styling
        if (isFancyFormattingMode) {
            displayTuning = applyMusicalAccidentalGlyphs(displayTuning);
        } else {
            displayTuning = revertToAsciiAccidentals(displayTuning);
        }
    }

    let transBadge = '';
    if (semitones !== 0) {
        const sign = semitones > 0 ? `+${semitones}` : `${semitones}`;
        transBadge = `<span class="chart-tuning-pill-transposed">Transposed ${sign}</span>`;
    }

    return `<div class="chart-tuning-banner">
        <span class="chart-tuning-icon">🎸</span>
        <span class="chart-tuning-label">Key & Tuning:</span>
        <span class="chart-tuning-value">${displayTuning}</span>
        ${transBadge}
    </div>`;
}

function renderDocxChartHtml() {
    const chartContainer = document.getElementById("chart-container");
    if (!chartContainer) return;
    const docxDiv = chartContainer.querySelector(".docx-content");
    if (!docxDiv || !rawCurrentDocxHtml) return;

    let html;
    if (currentTransposeSemitones === 0 && currentAccidentalMode === 'auto') {
        html = isFancyFormattingMode ? formatChordsFancy(rawCurrentDocxHtml) : revertToAsciiAccidentals(rawCurrentDocxHtml);
    } else {
        html = transposeChartHtml(rawCurrentDocxHtml, currentTransposeSemitones);
        if (!isFancyFormattingMode) {
            html = revertToAsciiAccidentals(html);
        }
    }

    const bannerHtml = getTuningBannerHtml(currentTransposeSemitones);
    docxDiv.innerHTML = bannerHtml + html;
}

function toggleFancyFormattingMode() {
    isFancyFormattingMode = !isFancyFormattingMode;
    const chartContainer = document.getElementById("chart-container");
    if (chartContainer) {
        const docxDiv = chartContainer.querySelector(".docx-content");
        if (docxDiv) {
            if (isFancyFormattingMode) {
                docxDiv.classList.add("docx-fancy-mode");
            } else {
                docxDiv.classList.remove("docx-fancy-mode");
            }
        }
    }
    renderDocxChartHtml();
    updateTransposeUI();
}

function applyTransposition(delta, absolute = false) {
    if (!rawCurrentDocxHtml) return;
    if (absolute) {
        currentTransposeSemitones = delta;
    } else {
        currentTransposeSemitones += delta;
        // Clamp to -11 to +11 semitones
        if (currentTransposeSemitones > 11) currentTransposeSemitones -= 12;
        if (currentTransposeSemitones < -11) currentTransposeSemitones += 12;
    }

    updateTransposeUI();
    renderDocxChartHtml();
}

function toggleAccidentalMode() {
    if (currentAccidentalMode === 'auto') {
        currentAccidentalMode = 'sharp';
    } else if (currentAccidentalMode === 'sharp') {
        currentAccidentalMode = 'flat';
    } else {
        currentAccidentalMode = 'auto';
    }

    updateTransposeUI();
    renderDocxChartHtml();
}

function setupTransposeControls() {
    const downBtn = document.getElementById("transpose-down-btn");
    const upBtn = document.getElementById("transpose-up-btn");
    const resetBtn = document.getElementById("transpose-semitones");
    const accidentalBtn = document.getElementById("transpose-accidental-btn");
    const fancyBtn = document.getElementById("transpose-fancy-btn");

    if (downBtn) {
        downBtn.onclick = (e) => {
            e.stopPropagation();
            applyTransposition(-1);
        };
    }
    if (upBtn) {
        upBtn.onclick = (e) => {
            e.stopPropagation();
            applyTransposition(+1);
        };
    }
    if (resetBtn) {
        resetBtn.onclick = (e) => {
            e.stopPropagation();
            currentAccidentalMode = 'auto';
            applyTransposition(0, true);
        };
    }
    if (accidentalBtn) {
        accidentalBtn.onclick = (e) => {
            e.stopPropagation();
            toggleAccidentalMode();
        };
    }
    if (fancyBtn) {
        fancyBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFancyFormattingMode();
        };
    }
}

// 4. Client-side chart rendering (PDF.js Canvas & Mammoth.js DOM injection)
async function loadChartFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const container = document.getElementById("chart-container");
    container.innerHTML = "<p style='color: #71717a;'>Loading chart...</p>";
    
    // Reset transposition state for new chart
    currentTransposeSemitones = 0;
    rawCurrentDocxHtml = null;
    updateTransposeUI();

    try {
        const fileResult = await fetchChartBuffer(filename);
        if (!fileResult.ok) {
            throw new Error(`Could not find chart file "${filename}"`);
        }

        const buffer = fileResult.buffer;
        const resolvedExt = (fileResult.path || filename).split('.').pop().toLowerCase();

        if (resolvedExt === 'docx' || resolvedExt === 'doc') {
            // Mammoth.js converts DOCX arrayBuffer into semantic HTML and injects directly into DOM
            const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
            let docxHtml = result.value || '<p>Document has no readable text.</p>';
            
            // Map Wingdings & Word SMP arrows (U+1F868 / 🡨) and Private Use Area (PUA) symbols to safe standard Unicode arrows
            docxHtml = docxHtml
                .replace(/[\u{1F800}-\u{1F8FF}\uF000-\uF0FF🡨\uD83E\uDC68]+/gu, '←')
                .replace(/&#x(?:[fF]0[dD][fF7]|1[fF]868);/gi, '←')
                .replace(/&#(?:61663|129128);/g, '←')
                .replace(/[\u{1F86A}\u{1F862}\uF0E0\uF0D8🡪]+/gu, '→')
                .replace(/[\u{1F869}\u{1F861}\uF0E1🡩]+/gu, '↑')
                .replace(/[\u{1F86B}\u{1F863}\uF0E2🡫]+/gu, '↓');
                
            // Clean Word formatting artifacts (superscripts for flats like B<sup>b</sup>, slashes, etc.)
            docxHtml = cleanMammothDocxHtml(docxHtml);
                
            // Check if this chart is a NUMBERS / Nashville chart (which is key-independent and shouldn't transpose)
            const isNumbersChart = /[-_ ]numbers(?:\.|\b)/i.test(filename) || 
                                   /[-_ ]numbers(?:\.|\b)/i.test(fileResult.path || "");
            if (!isNumbersChart) {
                rawCurrentDocxHtml = docxHtml;
            } else {
                rawCurrentDocxHtml = null; // Do not enable transposition controls for numbers charts
            }
            const fancyClass = isFancyFormattingMode ? "docx-fancy-mode" : "";
            let initialHtml = docxHtml;
            if (rawCurrentDocxHtml) {
                initialHtml = isFancyFormattingMode ? formatChordsFancy(docxHtml) : revertToAsciiAccidentals(docxHtml);
            }
            const bannerHtml = getTuningBannerHtml(0);
            container.innerHTML = `<div class="docx-content ${fancyClass}">${bannerHtml}${initialHtml}</div>`;
            updateTransposeUI();
        } else if (ext === 'pdf') {
            // PDF.js renders PDF pages client-side onto HTML5 Canvas elements
            container.innerHTML = `<div id="pdf-wrapper" class="pdf-viewer-container"></div>`;
            const pdfWrapper = document.getElementById("pdf-wrapper");

            const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
            const pdf = await loadingTask.promise;

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                
                // Set appropriate scale for crisp display
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement("canvas");
                canvas.className = "pdf-page-canvas";
                const context = canvas.getContext("2d");
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                pdfWrapper.appendChild(canvas);

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };
                await page.render(renderContext).promise;
            }
        } else if (ext === 'html' || ext === 'htm') {
            const text = new TextDecoder().decode(buffer);
            container.innerHTML = text;
        } else {
            // Plain text or fallback
            const text = new TextDecoder().decode(buffer);
            container.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit; font-size: 1rem; line-height: 1.5;">${text}</pre>`;
        }
    } catch (err) {
        console.error("Error rendering chart:", err);
        container.innerHTML = `<p style='color: #dc2626;'>Error loading chart file (${filename}): ${err.message}</p>`;
    }
}

window.onload = initApp;
