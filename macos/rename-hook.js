(function () {
    "use strict";

    var bridge = window.bridge;
    if (typeof bridge?.registerHandler !== "function") return;
    var register = bridge.registerHandler;
    bridge.registerHandler = function (name, handler) {
        if (name !== "File.setFilePath") return register.apply(this, arguments);
        return register.call(this, name, function () {
            var oldPath = window.File?.bundle?.filePath;
            var result = handler.apply(this, arguments);
            var newPath = window.File?.bundle?.filePath;
            if (oldPath && newPath && oldPath !== newPath) {
                window.dispatchEvent(new CustomEvent("typora-plugin-mac-path-changed", {
                    detail: { oldPath: oldPath, newPath: newPath }
                }));
            }
            return result;
        });
    };
})();
