import { action, type DialAction, type DialRotateEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { dvConnection, type AdjustableControl, type ConnectionSnapshot, type ControlState, type LocoState } from "../dv-connection";

type Control = AdjustableControl;

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

		return action.setFeedback(this.formatFeedback(control.value ?? 0, locomotive, control));
	}

	protected formatFeedback(value: number, locomotive: LocoState, _control: ControlState) {
		const percentage = Math.round(value * 100);
		return {
			label: this.title,
			value: `${percentage}%`,
			speed: this.formatSpeed(locomotive),
			indicator: percentage,
		};
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

@action({ UUID: "com.john-lenz.dv-remote-dispatch.reverser" })
export class ReverserDisplay extends LocoControlDisplay {
	protected readonly control = "reverser";
	protected readonly title = "REVERSER";

	protected override formatFeedback(value: number, locomotive: LocoState, _control: ControlState) {
		const position = value < 0.25 ? "R" : value > 0.75 ? "F" : "N";
		return {
			label: this.title,
			value: position,
			speed: `${Math.round(locomotive.speedKph)} km/h`,
			indicator: Math.round(value * 100),
		};
	}
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.dynamic-brake" })
export class DynamicBrakeDisplay extends LocoControlDisplay {
	protected readonly control = "dynamicBrake";
	protected readonly title = "DYN BRAKE";
}

abstract class PositionControlDisplay extends LocoControlDisplay {
	protected override formatFeedback(value: number, _locomotive: LocoState, control: ControlState) {
		const positions = Math.max(2, control.positionCount ?? Math.round(control.notchCount ?? 1) + 1);
		const position = control.position ?? Math.round(value * (positions - 1));
		return {
			label: this.title,
			value: `${position + 1} / ${positions}`,
			speed: "",
			indicator: Math.round(value * 100),
		};
	}
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.headlights-front" })
export class FrontHeadlightsDisplay extends PositionControlDisplay {
	protected readonly control = "headlightsFront";
	protected readonly title = "FRONT LIGHTS";

	protected override formatFeedback(value: number, locomotive: LocoState, control: ControlState) {
		return this.formatHeadlights(value, locomotive, control);
	}

	private formatHeadlights(value: number, locomotive: LocoState, control: ControlState) {
		const position = control.position;
		const label = position === undefined
			? undefined
			: ["RED 1", "RED 2", "OFF", "RUNNING", "HEADLIGHT", "HIGH BEAM"][position];
		if (!label)
			return super.formatFeedback(value, locomotive, control);

		return {
			label: this.title,
			value: label,
			speed: "",
			indicator: Math.round(value * 100),
		};
	}
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.headlights-rear" })
export class RearHeadlightsDisplay extends PositionControlDisplay {
	protected readonly control = "headlightsRear";
	protected readonly title = "REAR LIGHTS";

	protected override formatFeedback(value: number, locomotive: LocoState, control: ControlState) {
		const position = control.position;
		const label = position === undefined
			? undefined
			: ["RED 1", "RED 2", "OFF", "RUNNING", "HEADLIGHT", "HIGH BEAM"][position];
		if (!label)
			return super.formatFeedback(value, locomotive, control);

		return {
			label: this.title,
			value: label,
			speed: "",
			indicator: Math.round(value * 100),
		};
	}
}

@action({ UUID: "com.john-lenz.dv-remote-dispatch.wipers" })
export class WipersDisplay extends PositionControlDisplay {
	protected readonly control = "wipers";
	protected readonly title = "WIPERS";

	protected override formatFeedback(value: number, locomotive: LocoState, control: ControlState) {
		const positions = Math.max(2, control.positionCount ?? Math.round(control.notchCount ?? 1) + 1);
		if (positions !== 4)
			return super.formatFeedback(value, locomotive, control);

		const position = control.position ?? Math.round(value * 3);
		return {
			label: this.title,
			value: ["OFF", "INT", "ON", "FAST"][position],
			speed: "",
			indicator: Math.round(value * 100),
		};
	}
}
