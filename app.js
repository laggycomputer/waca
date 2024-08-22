const exec = require("node:util").promisify(require("node:child_process").exec)
const path = require("node:path")
const fs = require("node:fs/promises")
const process = require("node:process")

const tmp = require("tmp")
tmp.setGracefulCleanup(true)
const express = require("express")
const app = express()
const shlex = require("shlex")
const yaml = require("yaml")

const config = require("./config")
app.locals.isVerbose = Boolean(config.verbose)
const { version } = require("./package.json")

app.locals.arduinoInvocation = config.arduinoInvocation

app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "*")
    next()
})

app.set("trust proxy", 1)

app.get("/version", (req, res) => {
    if (req.app.locals.isVerbose) { console.log("info: responding to GET /version") }
    res.json({ version, program: "waca" })
})

app.get("/boards", async (req, res) => {
    if (req.app.locals.isVerbose) { console.log("info: responding to GET /boards") }

    try {
        const { stdout } = await exec(req.app.locals.arduinoInvocation + " board listall --format json")
        res.json(JSON.parse(stdout).boards)
    } catch (err) {
        res.status(500).json({ error: "arduino-cli did not exit properly" })
    }
})

app.get("/libraries", async (req, res) => {
    if (req.app.locals.isVerbose) { console.log("info: responding to GET /libraries") }

    try {
        const { stdout } = await exec(req.app.locals.arduinoInvocation + " lib list --format json")
        res.json(
            JSON.parse(stdout).map(lib => {
                delete lib.library["install_dir"]
                delete lib.library["source_dir"]
                delete lib.library["examples"]

                return lib
            })
        )
    } catch (err) {
        res.status(500).json({ error: "arduino-cli did not exit properly" })
    }
})

function replaceAll(s, sub, to) {
    while (s.includes(sub)) {
        s = s.replace(sub, to)
    }
    return s
}

app.post("/compile", express.json(), async (req, res) => {
    if (req.app.locals.isVerbose) { console.log("info: responding to POST /compile") }

    const arduinoVerbose = req.body.verbose === "true"
    const boardFQBN = req.body.board ?? "arduino:avr:uno"

    const sketch = req.body.sketch

    // test for #include "./*" or #include "../*" and complain to prevent users from searching the filesystem
    // TODO: this doesn't forgive string literals with matching contents
    if (/#\s*include\s*"\.*\/.*"/.test(sketch)) {
        res.status(400).send(
            "relative quote imports are not allowed, omit ./ in front of quote import directives\n"
            + "for example, #include \"./foo.h\" should be #include \"foo.h\"")
        return
    }
    try {
        const { name: tmpDir, removeCallback: cleanup } = await new Promise((resolve, reject) => {
            tmp.dir({ prefix: "waca-sketch", unsafeCleanup: true }, (err, dir, rm) => {
                if (err) { return reject(err) }

                resolve({ name: dir, removeCallback: rm })
            })
        })
        if (req.app.locals.isVerbose) { console.log("info: created temp dir " + tmpDir) }
        const sketchFilename = path.basename(tmpDir) + ".ino"
        const fullSketchPath = path.resolve(path.join(tmpDir, sketchFilename))

        try {
            await fs.writeFile(fullSketchPath, sketch ?? "")
        } catch (err) {
            res.status(500).send("failed to save sketch to disk.")
            if (req.app.locals.isVerbose) { console.warn("warn: failed to save a sketch to disk. this should not happen.") }
            cleanup(); return
        }

        if (req.query["include_lcd_deps"] && boardFQBN.toLowerCase().startsWith("attinycore:avr")) {
            try {
                for (const file of await fs.readdir("extra-libs")) {
                    await fs.copyFile("extra-libs" + path.sep + file, tmpDir + path.sep + file)
                }
            } catch (err) {
                res.status(500).send("failed to copy some files.")
                cleanup(); return
            }
        }

        const compiledSubdir = path.join(tmpDir, "compiled")
        try {
            await fs.mkdir(compiledSubdir)
        } catch (err) {
            res.status(500).send("failed to create compilation folder.")
            if (req.app.locals.isVerbose) { console.warn("warn: failed to create a folder. this should not happen.") }
            cleanup(); return
        }

        const verbose = arduinoVerbose ? " -v" : ""
        const cmd = `${req.app.locals.arduinoInvocation} compile${verbose} -b ${boardFQBN} --output-dir ${shlex.quote(compiledSubdir)} --warnings none ${shlex.quote(fullSketchPath)}`

        let stdout, stderr

        const sanitize = string => {
            for (const [replaceFrom, replaceTo] of [
                [fullSketchPath, "<main sketch file>"],
                [tmpDir, "<sketch folder>"],
                [req.app.locals.arduinoCLIConfig.directories.data, "<libraries folder>"],
                [req.app.locals.arduinoCLIConfig.directories.user, "<libraries folder>"],
            ]) {
                string = replaceAll(string, replaceFrom, replaceTo)
            }

            return string
        }

        try {
            ({ stdout, stderr } = await exec(cmd, { cwd: tmpDir }))
        } catch (err) {
            res.status(400).json({ success: false, stdout: sanitize(err.stdout), stderr: sanitize(err.stderr) })
            cleanup(); return
        }

        stdout = sanitize(stdout)
        stderr = sanitize(stderr)

        try {
            const compilerOutputPath = boardFQBN.startsWith("esp8266:esp8266:") ? sketchFilename + ".bin" : sketchFilename + ".hex"
            const compilerOut = await fs.readFile(path.join(tmpDir, "compiled", compilerOutputPath), "base64")
            res.status(200).json({ success: true, hex: compilerOut, stdout, stderr })
        } catch (err) {
            res.status(500).send("failed to read compiler output.")
            // not warning because this is basically only the result of manual tampering
        } finally {
            cleanup()
        }
    } catch (err) {
        res.status(500).send("failed to allocate temporary sketch folder")
        console.warn("warn: failed to create a temp dir. this is not normal.")
        if (req.app.locals.isVerbose) { console.error(err) }
    }
})

async function main() {
    try {
        await exec(`${config.arduinoInvocation} version`)

        app.locals.arduinoCLIConfig = yaml.parse(await exec(`${config.arduinoInvocation} config dump`).then(r => r.stdout))
    } catch (err) {
        console.error(`FATAL: failed to invoke arduino-cli:\n${err}`)
        process.exit(-1)
    }

    const port = process.env["PORT"] || config.port || 80
    app.listen(port, () => { console.log(`Ready at port ${port}`) })
}

main()
