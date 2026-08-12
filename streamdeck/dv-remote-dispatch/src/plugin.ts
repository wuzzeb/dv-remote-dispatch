import streamDeck from "@elgato/streamdeck";

import { DynamicBrakeDisplay, FrontHeadlightsDisplay, IndependentBrakeDisplay, RearHeadlightsDisplay, ReverserDisplay, ThrottleDisplay, TrainBrakeDisplay, WipersDisplay } from "./actions/loco-control-display";
import { Sander } from "./actions/sander";
import { Horn } from "./actions/horn";
import { CabLight } from "./actions/cab-light";
import { dvConnection } from "./dv-connection";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new ThrottleDisplay());
streamDeck.actions.registerAction(new IndependentBrakeDisplay());
streamDeck.actions.registerAction(new TrainBrakeDisplay());
streamDeck.actions.registerAction(new ReverserDisplay());
streamDeck.actions.registerAction(new DynamicBrakeDisplay());
streamDeck.actions.registerAction(new Sander());
streamDeck.actions.registerAction(new FrontHeadlightsDisplay());
streamDeck.actions.registerAction(new RearHeadlightsDisplay());
streamDeck.actions.registerAction(new WipersDisplay());
streamDeck.actions.registerAction(new Horn());
streamDeck.actions.registerAction(new CabLight());

streamDeck.connect();
dvConnection.start();
