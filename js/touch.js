/*!
 * Комната 863 — сенсорное управление для телефонов и планшетов.
 *
 * Работает поверх игры: джойстик слева — движение, свайп справа — обзор,
 * кнопка «E» — действие, «II» — выход в меню.
 * Уровни предоставляют мост window.R863Input (см. конец скрипта уровня).
 *
 * Проверка на компьютере: открой index.html?touch=1
 */
(function (global) {
    'use strict';

    if (!global.R863 || !global.R863.isTouchDevice()) return;

    var doc = global.document;

    var CONFIG = {
        joystickAreaRatio: 0.42,   // левая доля экрана под джойстик
        joystickRadius: 60,        // максимальный ход ручки, px
        lookSensitivity: 0.0035,   // px свайпа -> радианы поворота
        sprintThreshold: 0.85      // насколько сильно отклонить джойстик для бега
    };

    var ui = null;
    var stickPointer = null;
    var lookPointer = null;
    var lastLook = { x: 0, y: 0 };
    var lastMoveHint = { forward: false, backward: false, left: false, right: false };

    function api() {
        return global.R863Input || null;
    }

    /* ----------------------------- Разметка ----------------------------- */

    function injectStyles() {
        var style = doc.createElement('style');
        style.id = 'r863-touch-style';
        style.textContent =
            'html.r863-touch, html.r863-touch body { touch-action: none; overscroll-behavior: none; }' +
            'html.r863-touch { -webkit-user-select: none; user-select: none; }' +
            '#r863-stick, #r863-knob, #r863-action, #r863-pause {' +
            '  position: fixed; z-index: 15; display: none; border-radius: 50%;' +
            '  pointer-events: none; -webkit-tap-highlight-color: transparent;' +
            '}' +
            '#r863-stick { width: 130px; height: 130px; margin: -65px 0 0 -65px;' +
            '  border: 2px solid rgba(255,255,255,0.35); background: rgba(255,255,255,0.06); }' +
            '#r863-knob { width: 56px; height: 56px; margin: -28px 0 0 -28px;' +
            '  background: rgba(255,255,255,0.30); border: 2px solid rgba(255,255,255,0.5); }' +
            '#r863-action, #r863-pause {' +
            '  pointer-events: auto; display: flex; align-items: center; justify-content: center;' +
            '  background: rgba(0,0,0,0.45); border: 2px solid rgba(255,255,255,0.4); color: #fff;' +
            '  font: 700 22px/1 sans-serif; cursor: pointer; }' +
            '#r863-action { right: 24px; bottom: 32px; width: 74px; height: 74px; }' +
            '#r863-pause { right: 16px; top: 16px; width: 46px; height: 46px; font-size: 16px; }' +
            '#r863-action:active, #r863-pause:active { background: rgba(255,255,255,0.35); color: #000; }' +
            '.r863-touch-hint { margin-top: 18px; font-size: 13px; color: #888; line-height: 1.5; }';
        doc.head.appendChild(style);
    }

    function buildUi() {
        ui = {
            stick: doc.createElement('div'),
            knob: doc.createElement('div'),
            action: doc.createElement('div'),
            pause: doc.createElement('div')
        };

        ui.stick.id = 'r863-stick';
        ui.knob.id = 'r863-knob';
        ui.action.id = 'r863-action';
        ui.action.className = 'r863-control';
        ui.action.textContent = 'E';
        ui.action.title = 'Действие';
        ui.pause.id = 'r863-pause';
        ui.pause.className = 'r863-control';
        ui.pause.textContent = 'II';
        ui.pause.title = 'В главное меню';

        ui.action.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var a = api();
            if (a && a.interact) a.interact();
        });

        ui.pause.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (global.confirm('Выйти в главное меню? Уровень можно будет продолжить из меню.')) {
                global.location.href = 'index.html';
            }
        });

        doc.body.appendChild(ui.action);
        doc.body.appendChild(ui.pause);
        doc.body.appendChild(ui.stick);
        doc.body.appendChild(ui.knob);

        // Пока виден стартовый экран уровня, кнопки управления не нужны.
        updatePauseVisibility();
        var startScreens = doc.querySelectorAll('#clickToStart');
        for (var i = 0; i < startScreens.length; i++) {
            startScreens[i].addEventListener('click', function (e) {
                e.stopPropagation();
                var a = api();
                if (a && a.begin) a.begin();
            });
            var hint = doc.createElement('p');
            hint.className = 'r863-touch-hint';
            hint.textContent = 'Левая половина экрана — джойстик движения, правая — обзор. Кнопка «E» — действие.';
            startScreens[i].appendChild(hint);
        }

        // Наблюдаем за появлением/скрытием стартового экрана (пауза уровня).
        var startScreen = doc.getElementById('clickToStart');
        if (startScreen && global.MutationObserver) {
            new MutationObserver(updatePauseVisibility)
                .observe(startScreen, { attributes: true, attributeFilter: ['style'] });
        }
    }

    function updatePauseVisibility() {
        if (!ui) return;
        var startScreen = doc.getElementById('clickToStart');
        var blocked = !!startScreen && global.getComputedStyle(startScreen).display !== 'none';
        ui.pause.style.display = blocked ? 'none' : 'flex';
        if (blocked) {
            ui.action.style.display = 'none';
            hideStick();
        } else {
            ui.action.style.display = 'flex';
        }
    }

    /* ----------------------------- Джойстик ----------------------------- */

    function showStick(x, y) {
        ui.stick.style.left = x + 'px';
        ui.stick.style.top = y + 'px';
        ui.knob.style.left = x + 'px';
        ui.knob.style.top = y + 'px';
        ui.stick.style.display = 'block';
        ui.knob.style.display = 'block';
    }

    function hideStick() {
        if (!ui) return;
        ui.stick.style.display = 'none';
        ui.knob.style.display = 'none';
    }

    function sendMove(vectorX, vectorY) {
        var a = api();
        if (!a || !a.move) return;

        var threshold = 0.28;
        var state = {
            forward: vectorY < -threshold,
            backward: vectorY > threshold,
            left: vectorX < -threshold,
            right: vectorX > threshold
        };

        if (state.forward === lastMoveHint.forward && state.backward === lastMoveHint.backward &&
            state.left === lastMoveHint.left && state.right === lastMoveHint.right) {
            return; // не дёргаем уровень на каждый кадр пальца
        }
        lastMoveHint = state;
        a.move(state.forward, state.backward, state.left, state.right);

        if (a.setSprint) {
            var force = Math.min(1, Math.hypot(vectorX, vectorY));
            a.setSprint(force > CONFIG.sprintThreshold);
        }
    }

    function resetMove() {
        var a = api();
        lastMoveHint = { forward: false, backward: false, left: false, right: false };
        if (a && a.move) a.move(false, false, false, false);
        if (a && a.setSprint) a.setSprint(false);
    }

    function trackStick(clientX, clientY) {
        var dx = clientX - parseFloat(ui.stick.style.left);
        var dy = clientY - parseFloat(ui.stick.style.top);
        var distance = Math.hypot(dx, dy);
        var radius = CONFIG.joystickRadius;

        if (distance > radius) {
            dx = dx / distance * radius;
            dy = dy / distance * radius;
            distance = radius;
        }

        ui.knob.style.left = (parseFloat(ui.stick.style.left) + dx) + 'px';
        ui.knob.style.top = (parseFloat(ui.stick.style.top) + dy) + 'px';

        if (distance < 8) { resetMove(); return; }
        sendMove(dx / radius, dy / radius);
    }

    /* ------------------------------ Обзор ------------------------------ */

    function handleLookMove(clientX, clientY) {
        var a = api();
        var dx = clientX - lastLook.x;
        var dy = clientY - lastLook.y;
        lastLook.x = clientX;
        lastLook.y = clientY;
        if (a && a.look) a.look(dx * (CONFIG.lookSensitivity / 0.0025), dy * (CONFIG.lookSensitivity / 0.0025));
    }

    /* ---------------------------- Обработчики --------------------------- */

    function isUiTarget(target) {
        return !!(target && target.closest && target.closest('button, a, input, .r863-control'));
    }

    function isStartOverlay(target) {
        return !!(target && target.closest && target.closest('#clickToStart'));
    }

    function onPointerDown(e) {
        if (isUiTarget(e.target)) return;

        if (isStartOverlay(e.target)) {
            var a = api();
            if (a && a.begin) a.begin();
            return;
        }

        if (stickPointer === null && e.clientX < global.innerWidth * CONFIG.joystickAreaRatio) {
            stickPointer = e.pointerId;
            showStick(e.clientX, e.clientY);
            e.preventDefault();
            return;
        }

        if (lookPointer === null) {
            lookPointer = e.pointerId;
            lastLook.x = e.clientX;
            lastLook.y = e.clientY;
            e.preventDefault();
        }
    }

    function onPointerMove(e) {
        if (e.pointerId === stickPointer) {
            trackStick(e.clientX, e.clientY);
            e.preventDefault();
        } else if (e.pointerId === lookPointer) {
            handleLookMove(e.clientX, e.clientY);
            e.preventDefault();
        }
    }

    function onPointerUp(e) {
        if (e.pointerId === stickPointer) {
            stickPointer = null;
            hideStick();
            resetMove();
        } else if (e.pointerId === lookPointer) {
            lookPointer = null;
        }
    }

    function releaseAll() {
        stickPointer = null;
        lookPointer = null;
        hideStick();
        resetMove();
    }

    /* ------------------------------ Старт ------------------------------ */

    function init() {
        doc.documentElement.className += ' r863-touch';
        injectStyles();
        buildUi();

        global.addEventListener('pointerdown', onPointerDown, { passive: false });
        global.addEventListener('pointermove', onPointerMove, { passive: false });
        global.addEventListener('pointerup', onPointerUp);
        global.addEventListener('pointercancel', onPointerUp);
        global.addEventListener('blur', releaseAll);
        global.addEventListener('contextmenu', function (e) {
            if (!isUiTarget(e.target)) e.preventDefault();
        });
        doc.addEventListener('visibilitychange', function () {
            if (doc.hidden) releaseAll();
        });
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
})(window);
