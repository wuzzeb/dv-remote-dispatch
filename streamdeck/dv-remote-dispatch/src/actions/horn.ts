import { action, type KeyAction, type KeyDownEvent, type KeyUpEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { dvConnection, type ConnectionSnapshot } from "../dv-connection";

@action({ UUID: "com.john-lenz.dv-remote-dispatch.horn" })
export class Horn extends SingletonAction {
	private unsubscribe?: () => void;

	override onWillAppear(ev: WillAppearEvent): void {
		if (ev.action.isKey())
			this.unsubscribe ??= dvConnection.subscribe((snapshot) => this.renderAll(snapshot));
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!await dvConnection.set("horn", 1))
			await ev.action.showAlert();
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (!await dvConnection.set("horn", 0))
			await ev.action.showAlert();
	}

	private renderAll(snapshot: ConnectionSnapshot): void {
		this.actions.forEach((visibleAction) => {
			if (visibleAction.isKey())
				void this.render(visibleAction, snapshot);
		});
	}

	private async render(key: KeyAction, snapshot: ConnectionSnapshot): Promise<void> {
		await key.setTitle("");
		const horn = snapshot.state?.locomotive?.controls.horn;
		const active = snapshot.connected && horn?.available && (horn.value ?? 0) > 0;
		return key.setState(active ? 1 : 0);
	}
}
