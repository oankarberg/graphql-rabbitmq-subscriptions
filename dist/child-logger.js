"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function createChildLogger(logger, className) {
    return logger.child({ child: 'amqp-pubsub', 'class': className }, true);
}
exports.createChildLogger = createChildLogger;
//# sourceMappingURL=child-logger.js.map