using DV.RemoteControls;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using UnityEngine;

namespace DvMod.RemoteDispatch
{
    public static class CurrentLocoTelemetry
    {
        private static string currentState = EmptyStateJson();

        public static void CaptureState()
        {
            currentState = GetStateJson();
        }

        public static string GetCurrentStateJson()
        {
            return currentState;
        }

        public static bool AdjustControl(string control, int steps)
        {
            var trainCar = PlayerManager.Car;
            var controller = trainCar?.GetComponent<ILocomotiveRemoteControl>();
            var remoteController = trainCar?.GetComponent<RemoteControllerModule>();
            if (controller == null || remoteController == null || steps == 0)
                return false;

            switch (control)
            {
            case "throttle":
                remoteController.controlsOverrider.Throttle?.Set(
                    Mathf.Clamp01(controller.GetTargetThrottle() + steps / 9f));
                return remoteController.controlsOverrider.Throttle != null;
            case "independentBrake":
                remoteController.controlsOverrider.IndependentBrake?.Set(
                    Mathf.Clamp01(controller.GetTargetIndependentBrake() + steps * 0.05f));
                return remoteController.controlsOverrider.IndependentBrake != null;
            case "trainBrake":
                remoteController.controlsOverrider.Brake?.Set(
                    Mathf.Clamp01(controller.GetTargetBrake() + steps * 0.05f));
                return remoteController.controlsOverrider.Brake != null;
            case "reverser":
                var currentReverser = controller.GetReverserValue();
                var targetReverser = Mathf.Clamp01(currentReverser + Math.Sign(steps) * 0.5f);
                var forwardSpeedKph = trainCar!.GetForwardSpeed() * 3.6f;
                if ((targetReverser < 0.5f && forwardSpeedKph > 1f)
                    || (targetReverser > 0.5f && forwardSpeedKph < -1f))
                    return false;
                remoteController.controlsOverrider.Reverser?.Set(targetReverser);
                return remoteController.controlsOverrider.Reverser != null;
            default:
                return false;
            }
        }

        private static string GetStateJson()
        {
            var trainCar = PlayerManager.Car;
            JObject? locomotive = null;
            if (trainCar != null)
            {
                var controller = trainCar.GetComponent<ILocomotiveRemoteControl>();
                if (controller != null)
                {
                    locomotive = new JObject(
                        new JProperty("id", trainCar.ID),
                        new JProperty("guid", trainCar.CarGUID),
                        new JProperty("speedKph", Math.Round(trainCar.GetForwardSpeed() * 3.6f, 1)),
                        new JProperty("controls", new JObject(
                            Control("throttle", controller.GetTargetThrottle()),
                            Control("independentBrake", controller.GetTargetIndependentBrake()),
                            Control("trainBrake", controller.GetTargetBrake()),
                            Control("reverser", controller.GetReverserValue())
                        ))
                    );
                }
            }

            return JsonConvert.SerializeObject(new JObject(
                new JProperty("type", "state"),
                new JProperty("protocol", 1),
                new JProperty("locomotive", locomotive)
            ));
        }

        private static string EmptyStateJson()
        {
            return JsonConvert.SerializeObject(new JObject(
                new JProperty("type", "state"),
                new JProperty("protocol", 1),
                new JProperty("locomotive", JValue.CreateNull())
            ));
        }

        private static JProperty Control(string name, float value)
        {
            return new JProperty(name, new JObject(
                new JProperty("available", true),
                new JProperty("value", Math.Round(value, 3))
            ));
        }
    }
}
