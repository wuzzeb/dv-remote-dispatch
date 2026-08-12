import streamDeck from "@elgato/streamdeck";

import { IndependentBrakeDisplay, ReverserDisplay, ThrottleDisplay, TrainBrakeDisplay } from "./actions/loco-control-display";
import { dvConnection } from "./dv-connection";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new ThrottleDisplay());
streamDeck.actions.registerAction(new IndependentBrakeDisplay());
streamDeck.actions.registerAction(new TrainBrakeDisplay());
streamDeck.actions.registerAction(new ReverserDisplay());

streamDeck.connect();
dvConnection.start();
