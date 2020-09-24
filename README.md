[![CircleCI](https://circleci.com/gh/chefmao1/hotpot-protocol.svg?style=svg)](https://circleci.com/gh/chefmao1/hotpot-protocol)
[![Coverage Status](https://coveralls.io/repos/github/chefmao1/hotpot-protocol/badge.svg?branch=master)](https://coveralls.io/github/chefmao1/hotpot-protocol?branch=master)
# Hotpot-Protocol

Hotpot is another experimental protocol mashing up food memes, programmable money and yield farming. It features:

- an algorithmic monetory policy to seek eventual price stability, inspired by Basis and Carbon.money.
- a fair and familiar ditribution mechanism inspired by YFI, YAM and SushiSwap
- a great food meme symbolizing the core values of community bonding - Hot Pot!

At its core, Hotpot implements an oversimplified version of algorithmic central bank: If the token price is above the peg, more tokens will enter ciculation through staking rewards thus increase the supply; if the token price is below the peg, ciculating supply will stop growing until price peg being re-established.

A farming contract is adapted from Sushiswap (credits to @nomichef) to serve as the main portal of token distribution. An admin contract monitors the time-weighted average price of the token and updates the minting speed per preset rules. Please refer to the codes for details.

# Building
This repo uses truffle. Ensure that you have truffle installed.

To build the contracts run:

`$ truffle compile`

To perform unit tests run:

`$ npm run coverage`

