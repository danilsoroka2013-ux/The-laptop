/*!
 * Комната 863 — общие модули игры.
 * Громкость, прогресс, переходы между уровнями и понятные ошибки загрузки.
 * Подключается на всех страницах ПЕРЕД three.js и кодом уровня:
 *     <script src="js/room863.js"></script>
 */
(function (global) {
    'use strict';

    var STORAGE = {
        volume: 'room863.volume',
        progress: 'room863.progress'
    };

    // 1.0 = «как задумано в игре», ползунок только уменьшает общую громкость.
    var DEFAULT_VOLUME = 1;
    var MAX_LEVEL = 3;

    var LEVEL_FILES = {
        1: 'one.html',
        2: 'two.html',
        3: 'three.html'
    };

    function storageGet(key) {
        try { return global.localStorage.getItem(key); } catch (e) { return null; }
    }

    function storageSet(key, value) {
        try { global.localStorage.setItem(key, String(value)); } catch (e) { /* приватный режим браузера */ }
    }

    function clamp01(value) {
        value = Number(value);
        if (!isFinite(value)) return 0;
        return Math.min(1, Math.max(0, value));
    }

    var R863 = {
        LEVEL_FILES: LEVEL_FILES,
        MAX_LEVEL: MAX_LEVEL,

        /* ------------------------- Громкость ------------------------- */

        getVolume: function () {
            var raw = storageGet(STORAGE.volume);
            if (raw === null || raw === '') return DEFAULT_VOLUME;
            var value = Number(raw);
            return isFinite(value) ? clamp01(value) : DEFAULT_VOLUME;
        },

        setVolume: function (value) {
            var volume = clamp01(value);
            storageSet(STORAGE.volume, volume);
            return volume;
        },

        /**
         * Ставит элементу <audio> его «родную» громкость (base), умноженную на общую.
         * Возвращает тот же элемент, чтобы удобно писать:
         *     const sound = R863.applyVolume(new Audio('music/fon.mp3'), 0.4);
         */
        applyVolume: function (audioElement, baseVolume) {
            if (!audioElement) return audioElement;
            var base = typeof baseVolume === 'number' ? baseVolume : 1;
            audioElement.volume = clamp01(this.getVolume() * base);
            return audioElement;
        },

        /* -------------------------- Прогресс ------------------------- */

        // Возвращает номер самого дальнего открытого уровня (1..3).
        getProgress: function () {
            var value = parseInt(storageGet(STORAGE.progress), 10);
            if (!isFinite(value) || value < 1) return 1;
            return Math.min(MAX_LEVEL, value);
        },

        // Запоминает прогресс: назад он не откатывается.
        setProgress: function (level) {
            level = parseInt(level, 10);
            if (!isFinite(level)) return this.getProgress();
            level = Math.min(MAX_LEVEL, Math.max(1, level));
            if (level > this.getProgress()) storageSet(STORAGE.progress, level);
            return this.getProgress();
        },

        resetProgress: function () {
            storageSet(STORAGE.progress, 1);
            return 1;
        },

        /* -------------------------- Переходы ------------------------- */

        goTo: function (target) {
            global.location.href = LEVEL_FILES[target] || 'index.html';
        },

        goToMenu: function () {
            global.location.href = 'index.html';
        },

        /* ------------------------ Устройство ------------------------- */

        /**
         * Сенсорное устройство (телефон/планшет) определяется по основному способу ввода,
         * чтобы ноутбуки с тачскрином и мышью игрались как обычно.
         * Ручное переключение для проверки: index.html?touch=1 или ?touch=0
         */
        isTouchDevice: function () {
            var forced = global.location.search.match(/[?&]touch=([01])/);
            if (forced) return forced[1] === '1';
            try {
                return !!(global.matchMedia && global.matchMedia('(hover: none) and (pointer: coarse)').matches);
            } catch (e) {
                return false;
            }
        },

        /* --------------------- Загрузка движка ------------------------ */

        /**
         * Проверяет, что three.js загрузился (локальная копия в vendor/),
         * иначе пробует CDN, а при неудаче показывает понятное сообщение
         * вместо чёрного экрана.
         */
        ensureThree: function () {
            function webglAvailable() {
                try {
                    var canvas = document.createElement('canvas');
                    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
                } catch (e) {
                    return false;
                }
            }

            function verify() {
                if (typeof global.THREE === 'undefined') {
                    R863.showFatalError(
                        'НЕ УДАЛОСЬ ЗАГРУЗИТЬ ДВИЖОК ИГРЫ (three.js)\n\n' +
                        'Проверь, что папка vendor/ лежит рядом с html-файлами.\n' +
                        'Если игра открыта с диска — запусти её через локальный сервер:\n' +
                        'python -m http.server'
                    );
                    return;
                }
                if (!webglAvailable()) {
                    R863.showFatalError(
                        'БРАУЗЕР НЕ ПОДДЕРЖИВАЕТ WEBGL\n\n' +
                        'Игра не сможет рисовать 3D. Обнови браузер\n' +
                        'или включи аппаратное ускорение в его настройках.'
                    );
                }
            }

            if (typeof global.THREE !== 'undefined') { verify(); return; }

            var cdn = document.createElement('script');
            cdn.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
            cdn.onload = verify;
            cdn.onerror = verify;
            document.head.appendChild(cdn);
        },

        showFatalError: function (message) {
            function render() {
                if (document.getElementById('r863-fatal')) return;
                var box = document.createElement('div');
                box.id = 'r863-fatal';
                box.setAttribute('style',
                    'position:fixed;inset:0;z-index:99999;background:#000;color:#fff;' +
                    'display:flex;align-items:center;justify-content:center;text-align:center;' +
                    'padding:24px;font:16px/1.6 sans-serif;white-space:pre-line;');
                box.textContent = message;
                document.body.appendChild(box);
            }
            if (document.body) render();
            else document.addEventListener('DOMContentLoaded', render);
        }
    };

    global.R863 = R863;
})(window);
