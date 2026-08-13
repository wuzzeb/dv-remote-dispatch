import { action, type DialAction, type DialDownEvent, type DialRotateEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { dvConnection, type ConnectionSnapshot, type LocoState } from "../dv-connection";

@action({ UUID: "com.john-lenz.dv-remote-dispatch.combined-brake" })
export class CombinedBrakeDisplay extends SingletonAction {
	private unsubscribe?: () => void;
	private activeControl: "independentBrake" | "trainBrake" = "independentBrake";

	override onWillAppear(ev: WillAppearEvent): void {
		if (!ev.action.isDial())
			return;
		this.unsubscribe ??= dvConnection.subscribe((snapshot) => this.renderAll(snapshot));
	}

	override async onDialRotate(ev: DialRotateEvent): Promise<void> {
		if (!await dvConnection.adjust(this.activeControl, ev.payload.ticks))
			await ev.action.showAlert();
	}

	override async onDialDown(ev: DialDownEvent): Promise<void> {
		this.activeControl = this.activeControl === "independentBrake" ? "trainBrake" : "independentBrake";
	}

	private renderAll(snapshot: ConnectionSnapshot): void {
		this.actions.forEach((visibleAction) => {
			if (visibleAction.isDial())
				void this.render(visibleAction, snapshot);
		});
	}

	private async render(action: DialAction, snapshot: ConnectionSnapshot): Promise<void> {
		if (!snapshot.connected)
			return action.setFeedback({ label: "BRAKE", value: "DV OFF", warning: "", indicator: 0 });
		if (!snapshot.state?.locomotive)
			return action.setFeedback({ label: "BRAKE", value: "NO LOCO", warning: "", indicator: 0 });

		const locomotive = snapshot.state.locomotive;
		const control = locomotive.controls[this.activeControl];
		if (!control.available)
			return action.setFeedback({ label: "BRAKE", value: "N/A", warning: "", indicator: 0 });

		const feedback = this.formatFeedback(control.value ?? 0, locomotive, this.activeControl);
		return action.setFeedback(feedback);
	}

	private formatFeedback(value: number, locomotive: LocoState, activeControl: string) {
		const percentage = Math.round(value * 100);
		const label = activeControl === "independentBrake" ? "IND BRAKE" : "TRAIN BRAKE";
		const other = activeControl === "independentBrake" ? "trainBrake" : "independentBrake";
		const otherControl = locomotive.controls[other];
		const otherActive = otherControl.available && (otherControl.value ?? 0) > 0.001;
		const warning = otherActive && otherControl.value !== undefined
			? `${other === "trainBrake" ? "TRAIN" : "IND"}: ${Math.round(otherControl.value * 100)}%`
			: "";
		return {
			label,
			value: `${percentage}%`,
			warning,
			indicator: percentage,
		};
	}
}
