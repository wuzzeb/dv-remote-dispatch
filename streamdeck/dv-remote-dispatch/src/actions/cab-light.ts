import { action, type KeyAction, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { dvConnection, type ConnectionSnapshot, type ControlState } from "../dv-connection";

@action({ UUID: "com.john-lenz.dv-remote-dispatch.cab-light" })
export class CabLight extends SingletonAction {
	private unsubscribe?: () => void;

	override onWillAppear(ev: WillAppearEvent): void {
		if (ev.action.isKey())
			this.unsubscribe ??= dvConnection.subscribe((snapshot) => this.renderAll(snapshot));
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!await dvConnection.cycle("cabLight"))
			await ev.action.showAlert();
	}

	private renderAll(snapshot: ConnectionSnapshot): void {
		this.actions.forEach((visibleAction) => {
			if (visibleAction.isKey())
				void this.render(visibleAction, snapshot);
		});
	}

	private async render(key: KeyAction, snapshot: ConnectionSnapshot): Promise<void> {
		const cabLight = snapshot.state?.locomotive?.controls.cabLight;
		if (!snapshot.connected || !cabLight?.available) {
			await key.setTitle("");
			return key.setState(0);
		}

		const position = this.position(cabLight);
		await key.setTitle(position === 0 ? "" : position === 1 ? "GAUGES" : "CAB");
		return key.setState(position === 0 ? 0 : 1);
	}

	private position(control: ControlState): number {
		if (control.position !== undefined)
			return control.position;
		const positions = Math.max(2, control.positionCount ?? 3);
		return Math.round((control.value ?? 0) * (positions - 1));
	}
}
