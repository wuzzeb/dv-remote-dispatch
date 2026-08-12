import { action, type KeyAction, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { dvConnection, type ConnectionSnapshot } from "../dv-connection";

@action({ UUID: "com.john-lenz.dv-remote-dispatch.sander" })
export class Sander extends SingletonAction {
	private unsubscribe?: () => void;
	private active = false;

	override onWillAppear(ev: WillAppearEvent): void {
		if (!ev.action.isKey())
			return;
		this.unsubscribe ??= dvConnection.subscribe((snapshot) => this.renderAll(snapshot));
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const target = this.active ? 0 : 1;
		if (!await dvConnection.set("sander", target))
			await ev.action.showAlert();
		else
			this.active = target === 1;
	}

	private renderAll(snapshot: ConnectionSnapshot): void {
		this.actions.forEach((visibleAction) => {
			if (visibleAction.isKey())
				void this.render(visibleAction, snapshot);
		});
	}

	private async render(key: KeyAction, snapshot: ConnectionSnapshot): Promise<void> {
		await key.setTitle("");
		if (!snapshot.connected) {
			return key.setState(0);
		}
		if (!snapshot.state?.locomotive) {
			return key.setState(0);
		}

		const sander = snapshot.state.locomotive.controls.sander;
		if (!sander.available) {
			return key.setState(0);
		}

		const active = (sander.value ?? 0) > 0;
		this.active = active;
		return key.setState(active ? 1 : 0);
	}
}
