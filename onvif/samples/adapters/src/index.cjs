"use strict";

module.exports = {
    ...require("./backend.cjs"),
    ...require("./canonical.cjs"),
    ...require("./semantic.cjs"),
    ...require("./server.cjs"),
    ...require("./fault.cjs")
};
