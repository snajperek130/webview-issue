"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const path = require("path");
const DefaultSearchWindowHtml = `file://${path.join(__dirname, 'search-window.html')}`;
const ShouldDebug = !!process.env.ELECTRON_IN_PAGE_SEARCH_DEBUG;
const log = ShouldDebug
    ? console.log.bind(console)
    : function nop() {
    };
class InPageSearch extends events_1.EventEmitter {
    constructor(searcher, searcherParent, searchTarget, preload) {
        super();
        this.searcher = searcher;
        this.searcherParent = searcherParent;
        this.searchTarget = searchTarget;
        this.opened = false;
        this.requestId = null;
        this.prevQuery = '';
        this.activeIdx = 0;
        this.maxIdx = 0;
        this.initialized = false;
        if (preload) {
            this.initialize();
        }
    }
    openSearchWindow() {
        if (this.opened) {
            log('Already opened');
            return;
        }
        this.initialize();
        this.searcher.classList.remove('search-inactive');
        this.searcher.classList.remove('search-firstpaint');
        this.searcher.classList.add('search-active');
        this.opened = true;
        this.emit('open');
        this.focusOnInput();
    }
    closeSearchWindow() {
        if (!this.opened) {
            log('Already closed');
            return;
        }
        this.stopFind();
        this.searcher.send('electron-in-page-search:close');
        this.searcher.classList.remove('search-active');
        this.searcher.classList.add('search-inactive');
        this.emit('stop');
        this.requestId = null;
        this.prevQuery = '';
        this.opened = false;
    }
    isSearching() {
        return this.requestId !== null;
    }
    startToFind(query) {
        this.requestId = this.searchTarget.findInPage(query);
        this.activeIdx = 0;
        this.maxIdx = 0;
        this.prevQuery = query;
        this.emit('start', query);
        this.focusOnInputOnBrowserWindow();
    }
    findNext(forward) {
        if (!this.isSearching()) {
            throw new Error('Search did not start yet. Use .startToFind() method to start the search');
        }
        this.requestId = this.searchTarget.findInPage(this.prevQuery, {
            forward,
            findNext: true,
        });
        this.emit('next', this.prevQuery, forward);
        this.focusOnInputOnBrowserWindow();
    }
    stopFind() {
        this.searchTarget.stopFindInPage('clearSelection');
    }
    finalize() {
        this.searcherParent.removeChild(this.searcher);
    }
    initialize() {
        if (this.initialized) {
            return;
        }
        this.registerFoundCallback();
        this.setupSearchWindowWebview();
        this.initialized = true;
    }
    onSearchQuery(text) {
        log('Query from search window webview:', text);
        if (text === '') {
            this.closeSearchWindow();
            return;
        }
        if (!this.isSearching() || this.prevQuery !== text) {
            this.startToFind(text);
        }
        else {
            this.findNext(true);
        }
    }
    onFoundInPage(result) {
        log('Found:', result);
        if (this.requestId !== result.requestId) {
            return;
        }
        if (typeof result.activeMatchOrdinal === 'number') {
            this.activeIdx = result.activeMatchOrdinal;
        }
        if (typeof result.matches === 'number') {
            this.maxIdx = result.matches;
        }
        if (result.finalUpdate) {
            this.sendResult();
        }
    }
    registerFoundCallback() {
        if (isWebView(this.searchTarget)) {
            this.searchTarget.addEventListener('found-in-page', event => {
                this.onFoundInPage(event.result);
            });
        }
        else {
            this.searchTarget.on('found-in-page', (_, result) => {
                this.onFoundInPage(result);
            });
        }
    }
    setupSearchWindowWebview() {
        this.searcher.classList.add('search-inactive');
        this.searcher.classList.add('search-firstpaint');
        if (this.searcher.parentElement === null) {
            this.searcherParent.appendChild(this.searcher);
        }
        this.searcher.addEventListener('ipc-message', event => {
            switch (event.channel) {
                case 'electron-in-page-search:query': {
                    const text = event.args[0];
                    this.onSearchQuery(text);
                    break;
                }
                case 'electron-in-page-search:close': {
                    this.closeSearchWindow();
                    break;
                }
                case 'electron-in-page-search:back': {
                    const text = event.args[0];
                    if (this.isSearching() && text === this.prevQuery) {
                        this.findNext(false);
                    }
                    else {
                        if (text) {
                            this.onSearchQuery(text);
                        }
                    }
                    break;
                }
                case 'electron-in-page-search:forward': {
                    const text = event.args[0];
                    if (this.isSearching() && text === this.prevQuery) {
                        this.findNext(true);
                    }
                    else {
                        if (text) {
                            this.onSearchQuery(text);
                        }
                    }
                    break;
                }
                default:
                    break;
            }
        });
        if (ShouldDebug) {
            this.searcher.addEventListener('console-message', e => {
                log('Console message from search window:', `line:${e.line}: ${e.message}`, e.sourceId);
            });
        }
    }
    focusOnInput() {
        log('Set focus on search window');
        setImmediate(() => {
            this.searcher.focus();
            this.searcher.send('electron-in-page-search:focus');
            this.emit('focus-input');
        });
    }
    focusOnInputOnBrowserWindow() {
        if (isWebView(this.searchTarget)) {
            return;
        }
        if (this.maxIdx !== 0 && this.activeIdx === this.maxIdx) {
            setTimeout(this.focusOnInput.bind(this), 100);
            return;
        }
        this.focusOnInput();
    }
    sendResult() {
        const nth = this.activeIdx;
        const all = this.maxIdx;
        log('Send result:', nth, all);
        this.searcher.send('electron-in-page-search:result', nth, all);
        this.emit('found', this.prevQuery, nth, all);
    }
}
exports.InPageSearch = InPageSearch;
function isWebView(target) {
    return target.tagName !== undefined && target.tagName === 'WEBVIEW';
}
function fixPathSlashes(p) {
    if (process.platform !== 'win32') {
        return p;
    }
    let replaced = p.replace(/\\/g, '/');
    if (replaced[0] !== '/') {
        replaced = '/' + replaced;
    }
    return replaced;
}
function injectScriptToWebView(target) {
    const injected_script = fixPathSlashes(path.join(__dirname, 'search-window.js'));
    const css = fixPathSlashes(path.join(__dirname, 'default-style.css'));
    const script = `(function(){
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = '${css}';
        document.head.appendChild(l);
        const s = document.createElement('script');
        s.src = 'file://${injected_script}';
        document.body.appendChild(s);
    })()`;
    if (target.getWebContents && target.getWebContents()) {
        target.executeJavaScript(script, false);
    }
    else {
        target.addEventListener('dom-ready', () => {
            target.executeJavaScript(script, false);
        });
    }
}
function searchInPage(searchTarget, options) {
    options = options || {};
    if (!options.searchWindowWebview) {
        options.searchWindowWebview = document.createElement('webview');
        options.searchWindowWebview.className = 'electron-in-page-search-window';
        options.searchWindowWebview.setAttribute('nodeintegration', '');
        options.searchWindowWebview.style.outline = '0';
    }
    const wv = options.searchWindowWebview;
    if (!wv.src) {
        wv.src = options.customSearchWindowHtmlPath || DefaultSearchWindowHtml;
    }
    injectScriptToWebView(wv);
    if (options.openDevToolsOfSearchWindow) {
        const wc = wv.getWebContents && wv.getWebContents();
        if (wc) {
            wc.openDevTools({ mode: 'detach' });
        }
        else {
            wv.addEventListener('dom-ready', () => {
                wv.getWebContents().openDevTools({ mode: 'detach' });
            });
        }
    }
    return new InPageSearch(options.searchWindowWebview, options.searchWindowParent || document.body, searchTarget, !!options.preloadSearchWindow);
}
exports.default = searchInPage;
//# sourceMappingURL=index.js.map