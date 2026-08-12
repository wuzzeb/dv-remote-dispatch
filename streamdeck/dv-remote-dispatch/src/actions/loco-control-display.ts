import { action, type DialAction, type DialRotateEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { dvConnection, type ConnectionSnapshot, type LocoState } from "../dv-connection";

type Control = "throttle" | "independentBrake" | "trainBrake";

abstract class LocoControlDisplay extends SingletonAction {
	private unsubscribe?: () => void;

	protected abstract readonly control: Control;
	protected abstract readonly title: string;

	override onWillAppear(ev: WillAppearEvent): void {
		if (!ev.action.isDial())
			return;
		this.unsubscribe ??= dvConnection.subscribe((snapshot) => this.renderAll(snapshot));
	}

	override async onDialRotate(ev: DialRotateEvent): Promise<void> {
		if (!await dvConnection.adjust(this.control, ev.payload.ticks))
			await ev.action.showAlert();
	}

	private renderAll(snapshot: ConnectionSnapshot): void {
		this.actions.forEach((visibleAction) => {
			if (visibleAction.isDial())
				void this.render(visibleAction, snapshot);
		});
	}

	private render(action: DialAction, snapshot: ConnectionSnapshot): Promise<void> {
		if (!snapshot.connected)
			return action.setFeedback({ label: this.title, value: "DV OFF", speed: "", indicator: 0 });
		if (!snapshot.state?.locomotive)
			return action.setFeedback({ label: this.title, value: "NO LOCO", speed: "", indicator: 0 });

		const locomotive = snapshot.state.locomotive;
		const control = locomotive.controls[this.control];
		if (!control.available)
			return action.setFeedback({ label: this.title, value: "N/A", speed: "", indicator: 0 });

		const percentage = Math.round(control.value * 100);
		return action.setFeedback({
			label: this.title,
			value: `${percentage}%`,
			speed: this.formatSpeed(locomotive),
			indicator: percentage,
		});
	}

	protected formatSpeed(_locomotive: LocoState): string {
		return "";
	}
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.throttle" })
export class ThrottleDisplay extends LocoControlDisplay {
	protected readonly control = "throttle";
	protected readonly title = "THROTTLE";

	protected override formatSpeed(locomotive: LocoState): string {
		return `${Math.round(locomotive.speedKph)} km/h`;
	}
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.independent-brake" })
export class IndependentBrakeDisplay extends LocoControlDisplay {
	protected readonly control = "independentBrake";
	protected readonly title = "IND BRAKE";
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.train-brake" })
export class TrainBrakeDisplay extends LocoControlDisplay {
	protected readonly control = "trainBrake";
	protected readonly title = "TRAIN BRAKE";
}
