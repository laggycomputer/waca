const { execSync } = require("child_process")
const exec = require("util").promisify(require("child_process").exec)
const tmp = require("tmp")
tmp.setGracefulCleanup(true)
const path = require("path")
const fs = require("fs/promises")

const express = require("express")
const app = express()

const config = require("./config")
app.locals.is_verbose = Boolean(config.verbose)
const { version } = require("./package.json")

app.locals.arduino_invocation = config.arduino_invocation

app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "*")
    next()
})

app.set("trust proxy", 1)

app.get("/version", (req, res) => {
    if (req.app.locals.is_verbose) { console.log("info: responding to GET /version") }
    res.json({ version, program: "waca" })
})

app.get("/boards", async (req, res) => {
    if (req.app.locals.is_verbose) { console.log("info: responding to GET /boards") }

    try {
        const { stdout } = await exec(req.app.locals.arduino_invocation + " board listall --format json")
        res.json(JSON.parse(stdout).boards)
    } catch (err) {
        res.status(500).json({ error: "arduino-cli did not exit properly" })
    }
})

app.get("/libraries", (req, res) => {
    if (req.app.locals.is_verbose) { console.log("info: responding to GET /libraries") }

    try {
        const stdout = execSync(req.app.locals.arduino_invocation + " lib list --format json")
        let resp = JSON.parse(stdout)
        let to_send = []
        for (let lib of resp) {
            lib.library.install_dir = undefined
            lib.library.source_dir = undefined
            lib.library.examples = undefined
            to_send.push(lib)
        }
        res.json(to_send)
    } catch (err) {
        res.status(500).json({ error: "arduino-cli did not exit properly" })
    }
})

function replace_all_instances(s, sub, to) {
    while (s.includes(sub)) {
        s = s.replace(sub, to)
    }
    return s
}

app.post("/compile", express.json(), async (req, res) => {
    if (req.app.locals.is_verbose) { console.log("info: responding to POST /compile") }

    const arduino_verbose = req.body.verbose === "true"
    const board_fqbn = typeof (req.body.board) === "string" ? req.body.board : "arduino:avr:uno"

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
        const { name: tmp_dir_name, removeCallback: cleanup } = await new Promise((resolve, reject) => {
            tmp.dir({ prefix: "waca-sketch", unsafeCleanup: true }, (err, dir, rm) => {
                if (err) { return reject(err) }

                resolve({ name: dir, removeCallback: rm })
            })
        })
        if (req.app.locals.is_verbose) { console.log("info: created temp dir " + tmp_dir_name) }
        const sketch_filename_split = tmp_dir_name.split(path.sep)
        const sketch_filename = sketch_filename_split[sketch_filename_split.length - 1] + ".ino"
        const full_sketch_path = tmp_dir_name + path.sep + sketch_filename

        try {
            await fs.writeFile(full_sketch_path, sketch)
        } catch (err) {
            res.status(500).send("failed to save sketch to disk.")
            if (req.app.locals.is_verbose) { console.warn("warn: failed to save a sketch to disk. this should not happen.") }
            cleanup(); return
        }

        if (req.query.include_lcd_deps && board_fqbn.toLowerCase().startsWith("attinycore:avr")) {
            try {
                for (const file of await fs.readdir("extra_libs")) {
                    await fs.copyFile("extra_libs" + path.sep + file, tmp_dir_name + path.sep + file)
                }
            } catch (err) {
                res.status(500).send("failed to copy some files.")
                cleanup(); return
            }
        }

        try {
            await fs.mkdir(tmp_dir_name + path.sep + "compiled")
        } catch (err) {
            res.status(500).send("failed to create compilation folder.")
            if (req.app.locals.is_verbose) { console.warn("warn: failed to create a folder. this should not happen.") }
            cleanup(); return
        }

        const verbose = arduino_verbose ? " -v" : ""
        const cmd = `${req.app.locals.arduino_invocation} compile${verbose} -b ${board_fqbn} --output-dir "${tmp_dir_name + path.sep + "compiled"}" --warnings none "${full_sketch_path}"`

        let stdout, stderr

        try {
            ({ stdout, stderr } = await exec(cmd, { cwd: tmp_dir_name }))
        } catch (err) {
            res.status(400).json({ success: false, stdout: err.stdout, stderr: err.stderr })
            cleanup(); return
        }

        stdout = replace_all_instances(replace_all_instances(stdout, full_sketch_path, "<main sketch file>"), tmp_dir_name, "<sketch folder>")
        stderr = replace_all_instances(replace_all_instances(stderr, full_sketch_path, "<main sketch file>"), tmp_dir_name, "<sketch folder>")

        try {
            const compiler_out = await fs.readFile(`${tmp_dir_name}${path.sep}compiled${path.sep}${sketch_filename}.hex`, "base64")
            res.status(200).json({ success: true, hex: compiler_out, stdout, stderr })
        } catch (err) {
            res.status(500).send("failed to read compiler output.")
            // not warning because this is basically only the result of manual tampering
        } finally {
            cleanup()
        }
    } catch (err) {
        res.status(500).send("failed to allocate temporary sketch folder")
        console.warn("warn: failed to create a temp dir. this is not normal.")
    }
})

try {
    execSync(config.arduino_invocation + " version")
} catch (err) {
    console.error(`FATAL: failed to invoke arduino-cli:\n${err}`)
    process.exit(-1)
}

app.listen(config.port || 80, () => { console.log(`Ready at port ${config.port || 80}`) })
