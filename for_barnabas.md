# Introduction
This project was initially created to replace Chromeduino's compile server for Arduino and its faults. Its purpose was to replace its predecessor's place in the Barnabas Blocks toolchain, so this project is designed to behave identically in basic function.
Specifically, `waca` was created because Chromeduino was... less than perfect with library and board detection. For those looking to fulfill all the dependencies Barnabas Blocks requires, see below:

1. Install `arduino-cli` [here](https://arduino.github.io/arduino-cli/latest/installation/). You do not need to modify any configs. If you choose not to add it to PATH or place it somewhere already on PATH, you must specify its absolute path in `config.js`.
2. Run `npm install` in the directory of this project. If you are in production and intend to develop you can add `--production=true`.
3. Install ATTinyCore, the board defintion including ezDisplay: `arduino-cli --additional-urls http://drazzy.com/package_drazzy.com_index.json core install ATTinyCore:avr`
4. Install Tiny4kOLED: `arduino-cli lib install Tiny4kOLED@1.5.4`
5. To install [`tiny-i2c`](https://github.com/technoblogy/tiny-i2c), we need to replicate Arduino IDE's library installation from .zip mechanic. Run `arduino-cli config dump` and look for the "user" folder under the directories section. Move there and create a libraries folder (which should exist already anyways). Then download the [TinyI2C ZIP](https://github.com/technoblogy/tiny-i2c/archive/refs/heads/master.zip), extract out `tiny-i2c-master/tiny-i2c`, and place the latter directory in the libraries folder.
6. The dependencies are ready. Run `node app.js` in this project to start the server. You may wish to specify a different port or verbosity but these settings are fine as is for production.
