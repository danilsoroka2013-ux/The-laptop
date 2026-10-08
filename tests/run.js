/* Автотесты «Комната 863»: jsdom + заглушка three.js.
 * Часть A — страницы как в браузере (локальный сервер, реальные теги <script>).
 * Часть B — белые тесты: доступ к внутренним объектам уровня.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.resolve(__dirname, '..');
const STUB_THREE = fs.readFileSync(path.join(__dirname, 'three-stub.browser.js'), 'utf8');
const ROOM863_SRC = fs.readFileSync(path.join(REPO, 'js/room863.js'), 'utf8');
const TOUCH_SRC = fs.readFileSync(path.join(REPO, 'js/touch.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, extra) {
    if (ok) { passed++; console.log('   ✓ ' + name); }
    else { failed++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('   ✗ ' + name + (extra ? '  >> ' + extra : '')); }
}
function section(title) { console.log('\n=== ' + title + ' ==='); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const openDoms = [];   // окна jsdom держат rAF-циклы, их надо закрыть перед выходом

/* ----------------------------- общие заглушки ----------------------------- */

function browserStubs(window, options = {}) {
    // Записываем все созданные <audio>, чтобы проверять громкость и пути к файлам.
    const NativeAudio = window.Audio;
    window.__audios = [];
    window.Audio = function TrackedAudio(src) {
        const el = new NativeAudio(src);
        el.__src = src;
        el.__played = 0;
        window.__audios.push(el);
        return el;
    };

    window.HTMLMediaElement.prototype.play = function () { this.__played++; return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () { this.__paused = true; };
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
        configurable: true, get() { return this.__ct || 0; }, set(v) { this.__ct = v; }
    });

    // Canvas: 2d-контекст-заглушка (процедурные текстуры игры) и «WebGL».
    const ctx = { measureText: () => ({ width: 10 }), getImageData: () => ({ data: [] }),
        createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
        createPattern: () => ({}) };
    ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo',
        'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale',
        'drawImage', 'putImageData', 'setTransform', 'clip', 'rect'].forEach(m => { ctx[m] = function () {}; });
    window.HTMLCanvasElement.prototype.getContext = function (type) { return type === '2d' ? ctx : {}; };

    // Pointer lock, как в настоящем браузере.
    let locked = null;
    Object.defineProperty(window.document, 'pointerLockElement', { configurable: true, get: () => locked });
    window.__lock = function (element) {
        locked = element;
        window.document.dispatchEvent(new window.Event('pointerlockchange'));
    };
    window.document.exitPointerLock = function () {
        locked = null;
        window.document.dispatchEvent(new window.Event('pointerlockchange'));
    };

    window.confirm = () => true;
    // jsdom умеет реально закрывать окно — эмулируем браузер, который вкладку не закрыл.
    window.close = function () {};
    if (options.storage) {
        for (const [key, value] of Object.entries(options.storage)) window.localStorage.setItem(key, String(value));
    }
    if (options.onError) {
        window.addEventListener('error', e => options.onError(e.message || String(e.error)));
    }
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };

function startServer() {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            const file = urlPath === '/' ? '/index.html' : urlPath;
            if (file === '/vendor/three.min.js') {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                return res.end(STUB_THREE);
            }
            const full = path.join(REPO, file);
            if (!full.startsWith(REPO)) { res.writeHead(403); return res.end('forbidden'); }
            fs.readFile(full, (err, data) => {
                if (err) { res.writeHead(404); return res.end('not found: ' + file); }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

async function openPage(baseUrl, page, options = {}) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', e => {
        const msg = e.message || String(e);
        if (/Not implemented: navigation/.test(msg)) return; // переходы между уровнями в jsdom не работают
        errors.push(msg);
    });
    virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));

    const url = baseUrl + '/' + page + (options.query || '');
    const dom = await JSDOM.fromURL(url, {
        runScripts: 'dangerously',
        resources: 'usable',
        pretendToBeVisual: true,
        virtualConsole,
        beforeParse(window) { browserStubs(window, { storage: options.storage, onError: m => errors.push('window error: ' + m) }); }
    });
    openDoms.push(dom);
    await new Promise(resolve => dom.window.addEventListener('load', resolve));
    await sleep(120);
    return { dom, window: dom.window, errors };
}

function dispatchPointerDown(window, element, x, y, pointerId) {
    const event = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    element.dispatchEvent(event);
    return event;
}

function audioBySrc(window, needle) {
    return (window.__audios || []).find(a => (a.__src || '').includes(needle));
}

/* ============================ ЧАСТЬ A: страницы ============================ */

async function partA(baseUrl) {
    section('A. Меню (index.html)');
    {
        const { window, errors } = await openPage(baseUrl, 'index.html');
        check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
        check('громкость по умолчанию — 100%', window.document.getElementById('volume-value').textContent === '100%');
        check('кнопка «Продолжить» скрыта без прогресса', window.document.getElementById('continue-button').hidden === true);

        const slider = window.document.getElementById('volume-slider');
        slider.value = '0.4';
        slider.dispatchEvent(new window.Event('input', { bubbles: true }));
        check('ползунок сохраняет громкость в localStorage', window.localStorage.getItem('room863.volume') === '0.4',
            'получено: ' + window.localStorage.getItem('room863.volume'));
        check('подпись громкости обновилась', window.document.getElementById('volume-value').textContent === '40%');

        window.document.querySelector('button[onclick="resetProgress()"]').click();
        check('сброс прогресса не падает', window.localStorage.getItem('room863.progress') === '1');

        window.document.querySelector('button[onclick="exitGame()"]').click();
        await sleep(500);
        check('кнопка «Выход» показывает подсказку вместо тихого игнора',
            window.document.getElementById('exit-hint').hidden === false);
    }

    section('A. Меню с сохранённым прогрессом');
    {
        const { window, errors } = await openPage(baseUrl, 'index.html', { storage: { 'room863.progress': 2 } });
        check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
        const button = window.document.getElementById('continue-button');
        check('видна кнопка «Продолжить»', button.hidden === false);
        check('кнопка ведёт на 2 уровень', /УРОВЕНЬ 2/.test(button.textContent), button.textContent);
    }

    section('A. Уровень 1 (one.html)');
    {
        const { window, errors } = await openPage(baseUrl, 'one.html');
        check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));

        const fon = audioBySrc(window, 'fon.mp3'), knock = audioBySrc(window, 'knock.mp3'), door = audioBySrc(window, 'door_open.mp3');
        check('созданы все три звука уровня', !!fon && !!knock && !!door);
        check('ИСПРАВЛЕН звук двери: music/door_open.mp3 (было music/door.mp3)', door && door.__src === 'music/door_open.mp3',
            door ? door.__src : 'нет звука');
        check('громкость фона = 0.2 × 1.0 = 0.2', Math.abs(fon.volume - 0.2) < 1e-6, String(fon.volume));
        check('громкость стука = 0.6', Math.abs(knock.volume - 0.6) < 1e-6, String(knock.volume));
        const progress1 = window.localStorage.getItem('room863.progress');
        check('прогресс уровня 1 корректен', progress1 === null || progress1 === '1', String(progress1));

        window.document.getElementById('clickToStart').click();
        await sleep(60);
        check('по клику игра запускается (оверлей скрыт)',
            window.document.getElementById('clickToStart').style.display === 'none');
        check('музыка заиграла', fon.__played > 0);

        window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
        window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
        check('клавиатура не ломает уровень', errors.length === 0, errors.join(' | '));
    }

    section('A. Уровень 1 при громкости 50%');
    {
        const { window } = await openPage(baseUrl, 'one.html', { storage: { 'room863.volume': 0.5 } });
        const fon = audioBySrc(window, 'fon.mp3');
        check('общая громкость применяется к фону (0.2 × 0.5 = 0.1)', Math.abs(fon.volume - 0.1) < 1e-6, String(fon.volume));
    }

    section('A. Уровень 2 (two.html)');
    {
        const { window, errors } = await openPage(baseUrl, 'two.html');
        check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
        const checks = [['fon.mp3', 0.4], ['scream.mp3', 0.9], ['knock.mp3', 0.6], ['door_open.mp3', 0.6], ['door_close.mp3', 0.6]];
        checks.forEach(([src, volume]) => {
            const audio = audioBySrc(window, src);
            check('звук ' + src + ' с громкостью ' + volume, audio && Math.abs(audio.volume - volume) < 1e-6,
                audio ? String(audio.volume) : 'не создан');
        });
        check('страница закрывает </html>', /<\/html>\s*$/i.test(fs.readFileSync(path.join(REPO, 'two.html'), 'utf8')));
        check('прогресс записан (уровень 2)', window.localStorage.getItem('room863.progress') === '2');

        window.document.getElementById('clickToStart').click();
        await sleep(60);
        check('уровень запускается по клику', window.document.getElementById('clickToStart').style.display === 'none');
    }

    section('A. Уровень 3 (three.html)');
    {
        const { window, errors } = await openPage(baseUrl, 'three.html');
        check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
        check('фон 0.45', Math.abs(audioBySrc(window, 'fon.mp3').volume - 0.45) < 1e-6);
        check('крик на полной громкости', Math.abs(audioBySrc(window, 'scream.mp3').volume - 1) < 1e-6);
        check('счётчик генераторов заполнен', /Генераторы: 0 \/ [3-5]/.test(window.document.getElementById('taskCounter').innerText),
            window.document.getElementById('taskCounter').innerText);
        window.document.getElementById('clickToStart').click();
        await sleep(60);
        check('уровень запускается по клику', window.document.getElementById('clickToStart').style.display === 'none');
    }

    section('A. Сенсорный режим (?touch=1)');
    {
        const { window, errors } = await openPage(baseUrl, 'three.html', { query: '?touch=1' });
        check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
        check('на странице появились кнопки сенсорного управления',
            !!window.document.getElementById('r863-action') && !!window.document.getElementById('r863-pause'));
        check('html помечен классом r863-touch', /\br863-touch\b/.test(window.document.documentElement.className));
        const hint = window.document.querySelector('#clickToStart .r863-touch-hint');
        check('в стартовом экране есть подсказка по управлению', !!hint, hint ? hint.textContent.slice(0, 40) : 'нет');

        dispatchPointerDown(window, window.document.getElementById('clickToStart'), 100, 400, 1);
        await sleep(60);
        check('касание запускает игру без pointer lock',
            window.document.getElementById('clickToStart').style.display === 'none');
    }
}

/* ======================= ЧАСТЬ B: внутренние проверки ======================= */

function extractInlineScripts(html) {
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html))) scripts.push(match[1]);
    return scripts;
}

async function unitWindow(page, exportSnippet) {
    const html = fs.readFileSync(path.join(REPO, page), 'utf8');
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', e => {
        const msg = e.message || String(e);
        if (/Not implemented: navigation/.test(msg)) return;
        errors.push(msg);
    });
    const dom = new JSDOM(html, {
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
        url: 'http://localhost:8123/' + page,
        beforeParse(window) { browserStubs(window, { onError: m => errors.push('window error: ' + m) }); }
    });
    openDoms.push(dom);
    const { window } = dom;
    window.eval(ROOM863_SRC);
    window.eval(STUB_THREE);
    window.eval(TOUCH_SRC);
    const code = extractInlineScripts(html).join('\n;\n') + '\n;window.__T = {' + exportSnippet + '};\n';
    window.eval(code);
    await sleep(80);
    return { window, errors, dom };
}

async function partB() {
    section('B. Уровень 1 — внутренние проверки');
    {
        const { window, errors } = await unitWindow('one.html',
            'game, cameraPivot, R863Input: window.R863Input, soundDoor, soundFon, laptopScreen, passwordInput, submitPassword, moveControls, startScreen');
        const T = window.__T;
        check('инициализация без ошибок', errors.length === 0, errors.join(' | '));
        check('код на стене — три цифры', /^\d{3}$/.test(T.game.correctCode), T.game.correctCode);
        check('мост R863Input объявлен', !!T.R863Input);
        check('начальное состояние — start', T.game.state === 'start');

        T.R863Input.begin();
        check('R863Input.begin() переводит уровень в игру', T.game.state === 'playing');
        T.R863Input.move(true, false, false, false);
        check('R863Input.move() включает движение вперёд', T.moveControls.forward === true);
        const yawBefore = T.cameraPivot.rotation.y;
        T.R863Input.look(10, 0);
        check('R863Input.look() поворачивает камеру', T.cameraPivot.rotation.y !== yawBefore);

        // Дверь: раньше звук двери вообще не проигрывался из-за отсутствующего music/door.mp3
        T.game.lookingAt = 'door';
        T.R863Input.interact();
        check('дверь открывается по взаимодействию', T.game.doorOpened === true);
        check('звук двери действительно проигран', T.game.doorOpened && window.__audios.find(a => a.__src.includes('door_open')).__played > 0);

        // Ноутбук: неверный код -> появляется фонарик, верный -> win
        T.game.lookingAt = 'laptop';
        T.R863Input.interact();
        check('ноутбук открывает экран ввода кода', T.laptopScreen.style.display === 'flex');
        T.submitPassword.click(); // пустой код — заведомо неверный
        check('неверный код выдаёт фонарик', T.game.flashlightSpawned === true);

        T.game.lookingAt = 'laptop';
        T.R863Input.interact();
        T.passwordInput.value = T.game.correctCode;
        T.submitPassword.click();
        check('верный код переводит уровень в «win»', T.game.state === 'win');
        const progressWin = window.localStorage.getItem('room863.progress');
        check('прогресс уровня 1 корректен', progressWin === null || progressWin === '1', String(progressWin));
    }

    section('B. Уровень 2 — внутренние проверки');
    {
        const { window, errors } = await unitWindow('two.html',
            'game, cameraPivot, R863Input: window.R863Input, sounds, leverHandle, moveControls, handleInteraction');
        const T = window.__T;
        check('инициализация без ошибок', errors.length === 0, errors.join(' | '));
        check('мост R863Input объявлен', !!T.R863Input);

        T.R863Input.begin();
        check('R863Input.begin() переводит уровень в игру', T.game.state === 'playing');
        check('фон заиграл', T.sounds.fon.__played > 0);

        T.game.lookingAt = 'lever';
        T.R863Input.interact();
        check('рубильник активируется', T.game.leverActivated === true);
        check('звук открытия двери лифта проигран', T.sounds.doorOpen.__played > 0);
        check('двери лифта начали открываться', T.game.gateOpening === true);
        check('прогресс сохранён как 2', window.localStorage.getItem('room863.progress') === '2');
    }

    section('B. Уровень 3 — внутренние проверки');
    {
        const { window, errors } = await unitWindow('three.html',
            'game, cameraPivot, R863Input: window.R863Input, sounds, taskCounterEl, windOverlay, generators, exitCorridor, monster, raycaster, screamerEl');
        const T = window.__T;
        check('инициализация без ошибок', errors.length === 0, errors.join(' | '));
        T.R863Input.begin();
        check('R863Input.begin() переводит уровень в игру', T.game.state === 'playing');
        check('фон заиграл', T.sounds.fon.__played > 0);

        T.R863Input.setSprint(true);
        check('R863Input.setSprint() включает бег', T.game.isSprinting === true);
        check('эффект «ветра» включился', T.windOverlay.style.opacity === '1');

        // Генераторы: отклоняем луч-рейкаст, чтобы проверить логику отключения
        T.raycaster.intersectObject = () => [{ distance: 0.5 }];
        const total = T.game.totalGenerators;
        for (const generator of T.generators) {
            T.cameraPivot.position.copy(generator.mesh.position);
            T.R863Input.interact();
        }
        check('все генераторы отключаются', T.game.generatorsDeactivated === total,
            T.game.generatorsDeactivated + ' из ' + total);
        check('счётчик обновился', T.taskCounterEl.innerText === 'Генераторы: ' + total + ' / ' + total, T.taskCounterEl.innerText);
        check('выход открылся', T.exitCorridor.visible === true);

        // Смерть от монстра
        T.monster.position.set(T.cameraPivot.position.x + 0.5, 1.3, T.cameraPivot.position.z);
        await sleep(150);
        check('монстр убивает игрока вплотную', T.game.state === 'dead', T.game.state);
        check('показан скример', T.screamerEl.style.display === 'block');

        check('прогресс сохранён как 3', window.localStorage.getItem('room863.progress') === '3');
    }
}

/* --------------------------------- запуск --------------------------------- */

(async function main() {
    const { server, port } = await startServer();
    const baseUrl = 'http://127.0.0.1:' + port;
    try {
        await partA(baseUrl);
        await partB();
    } catch (error) {
        failed++;
        failures.push('ИСКЛЮЧЕНИЕ: ' + error.stack);
        console.error('\n!! Тестовый прогон упал:', error);
    } finally {
        server.close();
        for (const dom of openDoms) { try { dom.window.close(); } catch (e) {} }
    }

    console.log('\n───────────────');
    console.log(`Пройдено: ${passed}, провалено: ${failed}`);
    if (failures.length) {
        console.log('Провалы:');
        failures.forEach(f => console.log('  • ' + f));
        process.exit(1);
    }
    console.log('Все проверки прошли.');
    process.exit(0);
})();
