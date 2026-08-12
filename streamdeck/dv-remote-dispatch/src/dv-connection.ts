import streamDeck from "@elgato/streamdeck";

export type ControlState = {
	available: boolean;
	value: number;
};

export type LocoState = {
	id: string;
	guid: string;
	speedKph: number;
	controls: {
		throttle: ControlState;
		independentBrake: ControlState;
		trainBrake: ControlState;
		reverser: ControlState;
	};
};

export type TelemetryState = {
	type: "state";
	protocol: 1;
	locomotive: LocoState | null;
};

export type ConnectionSnapshot = {
	connected: boolean;
	state: TelemetryState | null;
};

type Listener = (snapshot: ConnectionSnapshot) => void;
export type AdjustableControl = "throttle" | "independentBrake" | "trainBrake" | "reverser";

class DvConnection {
	private pollTimer?: NodeJS.Timeout;
	private polling = false;
	private readonly listeners = new Set<Listener>();
	private snapshot: ConnectionSnapshot = { connected: false, state: null };

	start(): void {
		void this.poll();
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => this.listeners.delete(listener);
	}

	async adjust(control: AdjustableControl, steps: number): Promise<boolean> {
		try {
			const url = new URL("http://127.0.0.1:7245/api/streamdeck/v1/adjust");
			url.searchParams.set("control", control);
			url.searchParams.set("steps", String(steps));
			const response = await fetch(url, {
				method: "POST",
				signal: AbortSignal.timeout(1000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	private async poll(): Promise<void> {
		if (this.polling)
			return;
		this.polling = true;
		try {
			const response = await fetch("http://127.0.0.1:7245/api/streamdeck/v1", {
				signal: AbortSignal.timeout(1000),
			});
			if (!response.ok)
				throw new Error(`HTTP ${response.status}`);
			try {
				const state = await response.json() as TelemetryState;
				if (state.type === "state" && state.protocol === 1)
					this.publish({ connected: true, state });
			} catch (error) {
				streamDeck.logger.error(`Invalid DV telemetry message: ${String(error)}`);
			}
		} catch {
			this.publish({ connected: false, state: null });
		} finally {
			this.polling = false;
			this.pollTimer = setTimeout(() => void this.poll(), 100);
		}
	}

	private publish(snapshot: ConnectionSnapshot): void {
		this.snapshot = snapshot;
		this.listeners.forEach((listener) => listener(snapshot));
	}
}

export const dvConnection = new DvConnection();
