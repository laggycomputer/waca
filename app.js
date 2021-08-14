const express = require("express")
const app = express()

const { exec } = require("child_process")

const config = require("./config")
const port = !isNaN(Number(process.argv[2])) ? Number(process.argv[2]) : config.port
const { version } = "./package.json"

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-With")
    next()
})

app.set("trust proxy", 1)

app.get("/version", (req, res) => res.json({ version, program: "waca" }))


exec(config.arduino_invocation + " version", (error) => {
    if (error) {
        console.error(`FATAL: failed to invoke arduino-cli:\n${error}`)
        return
    }
    app.listen(port, () => {console.log(`Ready at port ${port}`)})
})
