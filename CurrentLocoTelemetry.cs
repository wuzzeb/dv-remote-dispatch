using DV.RemoteControls;
using DV.Simulation.Controllers;
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
            case "dynamicBrake":
                return MoveControl(remoteController.controlsOverrider.DynamicBrake, steps);
            case "headlightsFront":
                return MoveControl(remoteController.controlsOverrider.HeadlightsFront, steps);
            case "headlightsRear":
                return MoveControl(remoteController.controlsOverrider.HeadlightsRear, steps);
            case "wipers":
                return MoveControl(remoteController.controlsOverrider.Wipers, steps);
            default:
                return false;
            }
        }

        public static bool SetControl(string control, float value)
        {
            var controls = PlayerManager.Car?.GetComponent<RemoteControllerModule>()?.controlsOverrider;
            if (controls == null || control != "sander" || (value != 0f && value != 1f))
                return false;

            if (controls.Sander == null)
                return false;
            controls.Sander.Set(value);
            return true;
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
                    var controls = trainCar.GetComponent<RemoteControllerModule>()?.controlsOverrider;
                    var headlights = trainCar.SimController?.headlightsController;
                    var wipers = trainCar.SimController?.wipersController?.wiperController;
                    locomotive = new JObject(
                        new JProperty("id", trainCar.ID),
                        new JProperty("guid", trainCar.CarGUID),
                        new JProperty("speedKph", Math.Round(trainCar.GetForwardSpeed() * 3.6f, 1)),
                        new JProperty("controls", new JObject(
                            Control("throttle", controller.GetTargetThrottle()),
                            Control("independentBrake", controller.GetTargetIndependentBrake()),
                            Control("trainBrake", controller.GetTargetBrake()),
                            Control("reverser", controller.GetReverserValue()),
                            Control("dynamicBrake", controls?.DynamicBrake),
                            Control("sander", controls?.Sander),
                            Control("headlightsFront", controls?.HeadlightsFront,
                                headlights?.GetSetupCount(true)),
                            Control("headlightsRear", controls?.HeadlightsRear,
                                headlights?.GetSetupCount(false)),
                            Control("wipers", controls?.Wipers, wipers?.speeds.Length)
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

        private static JProperty Control(string name, OverridableBaseControl? control,
            int? positionCount = null)
        {
            if (control == null)
                return new JProperty(name, new JObject(new JProperty("available", false)));

            var state = new JObject(
                new JProperty("available", true),
                new JProperty("value", Math.Round(control.Value, 3)),
                new JProperty("isNotched", control.IsNotched),
                new JProperty("notchCount", Math.Round(control.NotchCount, 3))
            );
            if (positionCount > 0)
            {
                state.Add("position", Mathf.RoundToInt(control.Value * (positionCount.Value - 1)));
                state.Add("positionCount", positionCount.Value);
            }
            return new JProperty(name, state);
        }

        private static bool MoveControl(OverridableBaseControl? control, int steps)
        {
            if (control == null)
                return false;
            control.Move(Math.Sign(steps));
            return true;
        }
    }
}
