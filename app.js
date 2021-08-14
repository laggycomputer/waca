const express = require("express")
const app = express()

const { exec, execSync } = require("child_process")
const tmp = require("tmp")

const config = require("./config")
app.locals.is_verbose = Boolean(config.verbose)
const { version } = require("./package.json")

app.locals.arduino_invocation = config.arduino_invocation

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-With")
    next()
})

app.set("trust proxy", 1)

app.get("/version", (req, res) => {
    if (req.app.locals.is_verbose) console.log("info: responding to GET /version")
    res.json({ version, program: "waca" })
})

app.get("/boards", (req, res) => {
    if (req.app.locals.is_verbose) console.log("info: responding to GET /boards")

    exec(req.app.locals.arduino_invocation + " board listall --format json", (error, stdout, stderr) => {
        if (error) {
            res.status(500).json({ error: "arduino-cli did not exit properly", stderr: stderr })
            return
        }
        res.json(JSON.parse(stdout).boards)
    })
})

app.get("/libraries", (req, res) => {
    if (req.app.locals.is_verbose) console.log("info: responding to GET /libraries")

    exec(req.app.locals.arduino_invocation + " lib list --format json", (error, stdout, stderr) => {
        if (error) {
            res.status(500).json({ error: "arduino-cli did not exit properly", stderr: stderr })
            return
        }
        let resp = JSON.parse(stdout)
        let to_send = []
        for (let lib of resp) {
            lib.library.install_dir = undefined
            lib.library.source_dir = undefined
            lib.library.examples = undefined
            to_send.push(lib)
        }
        res.json(to_send)
    })
})

app.post("/compile", express.json(), (req, res) => {
    if (req.app.locals.is_verbose) console.log("info: responding to POST /compile")

    const arduino_verbose = req.body.verbose === "true"
    const board_fqbn = typeof (req.body.board) === "string" ? req.body.board : "arduino:avr:uno"
    const sketch = req.body.sketch

    // test for #include "./*" or #include "../*" and complain to prevent users from searching the filesystem
    // TODO: this doesn't forgive string literals with matching contents
    if (/#\s*include\s*"\.*\/.*"/.test(sketch)) {
        res.status(400).send(
            "relative quote imports are not allowed, omit ./ in front of quote import directives\n"
            + "for example, #include \"./foo.h\" should be #include \"foo.h\"")
    }
    const dir_obj = tmp.dirSync({ prefix: "waca-sketch", unsafeCleanup: true })
    const cleanup = dir_obj.removeCallback
    try {
        if (dir_obj.err) throw dir_obj.err
        if (req.app.locals.is_verbose) console.log("info: creating temp dir " + dir_obj.name)
    } catch (err) {
        res.status(500).send("failed to allocate temporary sketch folder")
        console.warn("warn: failed to create a temp dir. this is not normal.")
    }
    finally {
        cleanup()
        if (req.app.locals.is_verbose) console.log("info: cleaned up temp dir " + dir_obj.name)
    }
})

try {
    execSync(config.arduino_invocation + " version")
} catch (err) {
    console.error(`FATAL: failed to invoke arduino-cli:\n${err}`)
    process.exit(-1)
}

app.listen(config.port || 80, () => { console.log(`Ready at port ${config.port || 80}`) })
