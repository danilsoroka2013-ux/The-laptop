/* Заглушка three.js для автотестов: настоящая математика векторов, лучей и боксов,
 * но без WebGL. Подменяет собой vendor/three.min.js в тестовом окружении. */
(function (global) {
    'use strict';

    var doc = global.document;

    function Vector3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
    Vector3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
    Vector3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
    Vector3.prototype.clone = function () { return new Vector3(this.x, this.y, this.z); };
    Vector3.prototype.add = function (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; };
    Vector3.prototype.sub = function (v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; };
    Vector3.prototype.multiplyScalar = function (s) { this.x *= s; this.y *= s; this.z *= s; return this; };
    Vector3.prototype.length = function () { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); };
    Vector3.prototype.normalize = function () { var l = this.length() || 1; return this.multiplyScalar(1 / l); };
    Vector3.prototype.distanceTo = function (v) { return Math.sqrt(Math.pow(this.x - v.x, 2) + Math.pow(this.y - v.y, 2) + Math.pow(this.z - v.z, 2)); };
    Vector3.prototype.applyQuaternion = function () { return this; };

    function Vector2(x, y) { this.x = x || 0; this.y = y || 0; }
    Vector2.prototype.set = function (x, y) { this.x = x; this.y = y; return this; };

    function Color(value) { this.value = value; }
    Color.prototype.setHex = function (h) { this.value = h; return this; };
    Color.prototype.set = function (h) { this.value = h; return this; };
    Color.prototype.getHex = function () { return this.value; };

    function Object3D() {
        this.position = new Vector3();
        this.rotation = { x: 0, y: 0, z: 0, order: 'XYZ' };
        this.scale = new Vector3(1, 1, 1);
        this.children = [];
        this.visible = true;
        this.parent = null;
        this.castShadow = false;
        this.receiveShadow = false;
    }
    Object3D.prototype.add = function () {
        for (var i = 0; i < arguments.length; i++) {
            var child = arguments[i];
            if (!child) continue;
            child.parent = this;
            this.children.push(child);
        }
        return this;
    };
    Object3D.prototype.remove = function () { return this; };
    Object3D.prototype.lookAt = function () { return this; };
    Object3D.prototype.getWorldDirection = function (target) {
        // Как в three.js: направление взгляда — локальная -Z с учётом поворота родителя по Y.
        var yaw = this.rotation.y + (this.parent ? this.parent.rotation.y : 0);
        var pitch = this.rotation.x;
        var cosPitch = Math.cos(pitch);
        target.set(-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch);
        return target;
    };

    function Scene() { Object3D.call(this); this.fog = null; }
    Scene.prototype = Object.create(Object3D.prototype);

    function PerspectiveCamera(fov, aspect, near, far) {
        Object3D.call(this);
        this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
    }
    PerspectiveCamera.prototype = Object.create(Object3D.prototype);
    PerspectiveCamera.prototype.updateProjectionMatrix = function () {};

    function Light(hex, intensity, distance) {
        Object3D.call(this);
        this.intensity = intensity || 1;
        this.distance = distance || 0;
        this.color = new Color(hex);
    }
    Light.prototype = Object.create(Object3D.prototype);

    function PointLight(hex, intensity, distance) { Light.call(this, hex, intensity, distance); }
    PointLight.prototype = Object.create(Light.prototype);

    function SpotLight(hex, intensity, distance, angle, penumbra, decay) {
        Light.call(this, hex, intensity, distance);
        this.angle = angle || Math.PI / 3;
        this.penumbra = penumbra || 0;
        this.decay = decay === undefined ? 1 : decay;
        this.target = new Object3D();
    }
    SpotLight.prototype = Object.create(Light.prototype);

    function AmbientLight(hex, intensity) { Light.call(this, hex, intensity); }
    AmbientLight.prototype = Object.create(Light.prototype);

    function Geometry(size) { this.__size = size; }
    function BoxGeometry(w, h, d) { Geometry.call(this, { x: w, y: h, z: d }); }
    BoxGeometry.prototype = Object.create(Geometry.prototype);
    function PlaneGeometry(w, h) { Geometry.call(this, { x: w, y: h, z: 0.01 }); }
    PlaneGeometry.prototype = Object.create(Geometry.prototype);
    function CylinderGeometry(rTop, rBottom, height) { Geometry.call(this, { x: rTop * 2, y: height, z: rBottom * 2 }); }
    CylinderGeometry.prototype = Object.create(Geometry.prototype);

    function Material(params) {
        params = params || {};
        for (var key in params) if (Object.prototype.hasOwnProperty.call(params, key)) this[key] = params[key];
        this.color = new Color(params.color === undefined ? 0xffffff : params.color);
        this.emissive = new Color(params.emissive === undefined ? 0x000000 : params.emissive);
    }

    function Mesh(geometry, material) {
        Object3D.call(this);
        this.geometry = geometry;
        this.material = material;
    }
    Mesh.prototype = Object.create(Object3D.prototype);

    function Group() { Object3D.call(this); }
    Group.prototype = Object.create(Object3D.prototype);

    function CanvasTexture() {}
    function Texture() {}
    function TextureLoader() {}
    TextureLoader.prototype.load = function (url) {
        if (global.__needsTextureLoad) global.__needsTextureLoad.push(url);
        return new Texture();
    };

    /* ---------- Луч и бокс: настоящая геометрия, чтобы ИИ монстра работал ---------- */

    function Raycaster() {
        this.ray = { origin: new Vector3(), direction: new Vector3(0, 0, -1) };
    }
    Raycaster.prototype.setFromCamera = function () { return this; };
    Raycaster.prototype.set = function (origin, direction) {
        this.ray.origin = origin.clone ? origin.clone() : origin;
        this.ray.direction = direction.clone ? direction.clone() : direction;
        return this;
    };

    function intersectBox(ray, box) {
        var dir = ray.direction, origin = ray.origin;
        var tmin = -Infinity, tmax = Infinity;
        var axes = ['x', 'y', 'z'];
        for (var i = 0; i < axes.length; i++) {
            var axis = axes[i];
            var d = dir[axis];
            if (Math.abs(d) < 1e-8) {
                if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return null;
                continue;
            }
            var t1 = (box.min[axis] - origin[axis]) / d;
            var t2 = (box.max[axis] - origin[axis]) / d;
            if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return null;
        }
        return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : null);
    }

    Raycaster.prototype.__hits = function (objects) {
        var self = this;
        var hits = [];
        (objects || []).forEach(function (object) {
            if (!object || !object.geometry) return;
            var box = new Box3().setFromObject(object);
            var distance = intersectBox(self.ray, box);
            if (distance !== null) hits.push({ distance: distance, object: object });
        });
        hits.sort(function (a, b) { return a.distance - b.distance; });
        return hits;
    };
    Raycaster.prototype.intersectObject = function (object) { return this.__hits([object]); };
    Raycaster.prototype.intersectObjects = function (objects) { return this.__hits(objects); };

    function Box3() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
    Box3.prototype.setFromObject = function (object) {
        var size = (object.geometry && object.geometry.__size) || { x: 0.4, y: 0.4, z: 0.4 };
        this.min.set(object.position.x - size.x / 2, object.position.y - size.y / 2, object.position.z - size.z / 2);
        this.max.set(object.position.x + size.x / 2, object.position.y + size.y / 2, object.position.z + size.z / 2);
        return this;
    };
    Box3.prototype.containsPoint = function (point) {
        return point.x >= this.min.x && point.x <= this.max.x &&
               point.y >= this.min.y && point.y <= this.max.y &&
               point.z >= this.min.z && point.z <= this.max.z;
    };

    function WebGLRenderer() {
        this.domElement = doc.createElement('canvas');
        this.shadowMap = { enabled: false, type: 0 };
        this.renderCount = 0;
        var renderer = this;
        this.domElement.requestPointerLock = function () { global.__lockRequested = true; global.__lock(renderer.domElement); };
    }
    WebGLRenderer.prototype.setSize = function () {};
    WebGLRenderer.prototype.setPixelRatio = function () {};
    WebGLRenderer.prototype.render = function () { this.renderCount++; };

    global.THREE = {
        Scene: Scene,
        FogExp2: function (hex, density) { this.color = hex; this.density = density; },
        PerspectiveCamera: PerspectiveCamera,
        Object3D: Object3D,
        Group: Group,
        Mesh: Mesh,
        BoxGeometry: BoxGeometry,
        PlaneGeometry: PlaneGeometry,
        CylinderGeometry: CylinderGeometry,
        MeshBasicMaterial: Material,
        MeshStandardMaterial: Material,
        AmbientLight: AmbientLight,
        PointLight: PointLight,
        SpotLight: SpotLight,
        TextureLoader: TextureLoader,
        Texture: Texture,
        CanvasTexture: CanvasTexture,
        Raycaster: Raycaster,
        Box3: Box3,
        Vector2: Vector2,
        Vector3: Vector3,
        Color: Color,
        WebGLRenderer: WebGLRenderer,
        PCFSoftShadowMap: 2,
        MathUtils: { degToRad: function (d) { return d * Math.PI / 180; } }
    };
})(window);
