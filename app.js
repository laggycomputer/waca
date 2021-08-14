const express = require("express")
const app = express()

const { exec } = require("child_process")

const config = require("./config")
const port = !isNaN(Number(process.argv[2])) ? Number(process.argv[2]) : config.port
const { version } = require("./package.json")

app.locals.arduino_invocation = config.arduino_invocation

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-With")
    next()
})

app.set("trust proxy", 1)

app.get("/version", (req, res) => res.json({ version, program: "waca" }))

app.get("/boards", (req, res) => {
    exec(req.app.locals.arduino_invocation + " board listall --format json", (error, stdout, stderr) => {
        if (error) {
            res.status(500).json({ error: "arduino-cli did not exit properly", stderr: stderr })
            return
        }
        res.json(JSON.parse(stdout).boards)
    })
})

app.get("/libraries", (req, res) => {
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

exec(config.arduino_invocation + " version", (error) => {
    if (error) {
        console.error(`FATAL: failed to invoke arduino-cli:\n${error}`)
        return
    }
    app.listen(port, () => { console.log(`Ready at port ${port}`) })
})
