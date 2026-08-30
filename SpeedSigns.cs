using DV.PointSet;
using DV.Signs;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UnityEngine;

namespace DvMod.RemoteDispatch
{
    public static class SpeedSigns
    {
        private const float HASH_CELL_METERS = 5f;
        private const float SIGN_ASSIGN_RADIUS_METERS = 3.5f;
        private const float LOCO_SEARCH_RADIUS_METERS = 30f;
        private const float MAX_ROUTE_DISTANCE_METERS = 50000f;
        private const int MAX_SIGNS = 2;

        private class TrackEntry
        {
            public readonly RailTrack track;
            public readonly EquiPointSet pointSet;
            public readonly float length;

            public TrackEntry(RailTrack track)
            {
                this.track = track;
                this.pointSet = track.GetKinkedPointSet();
                this.length = (float)this.pointSet.span;
            }
        }

        private class WorldSign
        {
            public readonly Vector3 position;
            public readonly float speed;
            public readonly Vector3 facing;

            public WorldSign(Vector3 position, float speed, Vector3 facing)
            {
                this.position = position;
                this.speed = speed;
                this.facing = facing;
            }
        }

        private static List<WorldSign>? allSigns;
        private static string? allSignsJson;
        private static Dictionary<RailTrack, TrackEntry>? trackEntries;
        private static Dictionary<long, List<(TrackEntry entry, float span)>>? spatialIndex;
        private static Dictionary<TrackEntry, List<(float span, WorldSign sign, bool appliesToForward)>>? signsByTrack;
        private static readonly HashSet<long> knownSignKeys = new HashSet<long>();
        private static float lastSignScanTime;

        private static string upcomingJson = "[]";
        private static readonly object upcomingLock = new object();

        private static long CellKey(int cx, int cz)
        {
            return ((long)cx << 32) | (uint)cz;
        }

        public static string GetAllSignsJson()
        {
            EnsureLoaded();
            return allSignsJson ?? "[]";
        }

        public static string GetUpcomingJson()
        {
            lock (upcomingLock)
            {
                return upcomingJson;
            }
        }

        public static void CheckRouteState()
        {
            EnsureLoaded();
            if (trackEntries == null || spatialIndex == null)
                return;
            RefreshSigns();
            string json;
            try
            {
                json = ComputeUpcomingJson();
            }
            catch (Exception e)
            {
                Main.DebugLog(() => $"SpeedSigns error: {e}");
                json = "[]";
            }
            lock (upcomingLock)
            {
                if (upcomingJson != json)
                {
                    upcomingJson = json;
                    Sessions.AddTag("signs");
                }
            }
        }

        private static void EnsureLoaded()
        {
            if (allSigns != null)
                return;
            if (!WorldStreamingInit.Instance || !WorldStreamingInit.IsLoaded)
                return;

            var newEntries = new Dictionary<RailTrack, TrackEntry>();
            foreach (var railTrack in UnityEngine.Object.FindObjectsOfType<RailTrack>())
            {
                if (railTrack.GetKinkedPointSet() == null || railTrack.GetKinkedPointSet().span <= 0)
                    continue;
                newEntries[railTrack] = new TrackEntry(railTrack);
            }

            var newIndex = new Dictionary<long, List<(TrackEntry, float)>>();
            foreach (var entry in newEntries.Values)
            {
                foreach (var point in GenerateHashPoints(entry))
                {
                    var key = CellKey(
                        (int)Math.Floor((float)point.position.x / HASH_CELL_METERS),
                        (int)Math.Floor((float)point.position.z / HASH_CELL_METERS));
                    if (!newIndex.TryGetValue(key, out var list))
                    {
                        list = new List<(TrackEntry, float)>();
                        newIndex[key] = list;
                    }
                    list.Add((entry, (float)point.span));
                }
            }

            trackEntries = newEntries;
            spatialIndex = newIndex;
            signsByTrack = new Dictionary<TrackEntry, List<(float, WorldSign, bool)>>();
            allSigns = new List<WorldSign>();
            allSignsJson = "[]";
            RefreshSigns();
        }

        private static void RefreshSigns()
        {
            if (trackEntries == null || spatialIndex == null)
                return;
            var now = Time.time;
            if (allSigns != null && now - lastSignScanTime < 2f)
                return;
            lastSignScanTime = now;

            var found = new List<WorldSign>();
            foreach (var generator in UnityEngine.Object.FindObjectsOfType<SignGeneratorData>())
            {
                if (generator.signParameters == null)
                    continue;
                foreach (var sp in generator.signParameters)
                {
                    if (!IsSpeedLimitSign(sp))
                        continue;
                    float speed;
                    if (!float.TryParse(sp.signText, NumberStyles.Float, CultureInfo.InvariantCulture, out speed))
                        continue;
                    found.Add(new WorldSign(generator.transform.position - WorldMover.currentMove, speed,
                        generator.transform.forward));
                }
            }

            var newSigns = new List<WorldSign>();
            foreach (var sign in found)
            {
                var key = SignKey(sign);
                if (knownSignKeys.Add(key))
                    newSigns.Add(sign);
            }
            if (newSigns.Count == 0)
                return;

            foreach (var sign in newSigns)
            {
                var assigned = FindClosest(sign.position, SIGN_ASSIGN_RADIUS_METERS, trackEntries, spatialIndex);
                if (assigned == null)
                    continue;
                var entry = assigned.Value.entry;
                var span = FindSpanOnEntry(entry, sign.position);
                var trackForward = GetForwardAtSpan(entry, span);
                var appliesToForward = Vector3.Dot(sign.facing, trackForward) < 0f;
                if (!signsByTrack!.TryGetValue(entry, out var list))
                {
                    list = new List<(float, WorldSign, bool)>();
                    signsByTrack![entry] = list;
                }
                list.Add((span, sign, appliesToForward));
                allSigns!.Add(sign);
            }
            allSignsJson = JsonConvert.SerializeObject(allSigns.Select(s => new JObject(
                new JProperty("position", new World.Position(s.position).ToLatLon().ToJson()),
                new JProperty("speed", Math.Round(s.speed))
            )));
            Main.DebugLog(() => $"SpeedSigns: +{newSigns.Count} new signs, {allSigns.Count} total");
        }

        private static long SignKey(WorldSign sign)
        {
            return CellKey(
                (int)Math.Round(sign.position.x * 10f),
                (int)Math.Round(sign.position.z * 10f));
        }

        private static IEnumerable<EquiPointSet.Point> GenerateHashPoints(TrackEntry entry)
        {
            EquiPointSet coarse;
            try
            {
                coarse = EquiPointSet.ResampleEquidistant(entry.pointSet, HASH_CELL_METERS);
            }
            catch
            {
                coarse = entry.pointSet;
            }
            return coarse.points;
        }

        private static bool IsSpeedLimitSign(SignParameters sp)
        {
            switch (sp.type)
            {
            case SignType.SpeedLimit:
            case SignType.SpeedLimitOld:
            case SignType.SpeedLimitYellow:
            case SignType.SpeedLimitYellowOld:
                return true;
            default:
                return false;
            }
        }

        private static (TrackEntry entry, float span)? FindClosest(
            Vector3 position,
            float maxDistance,
            Dictionary<RailTrack, TrackEntry> entries,
            Dictionary<long, List<(TrackEntry, float)>> index)
        {
            var bestDistanceSqr = maxDistance * maxDistance;
            (TrackEntry entry, float span)? best = null;

            var cx = (int)Math.Floor(position.x / HASH_CELL_METERS);
            var cz = (int)Math.Floor(position.z / HASH_CELL_METERS);
            for (var dx = -1; dx <= 1; dx++)
            {
                for (var dz = -1; dz <= 1; dz++)
                {
                    if (!index.TryGetValue(CellKey(cx + dx, cz + dz), out var list))
                        continue;
                    foreach (var (entry, _) in list)
                    {
                        var span = FindSpanOnEntry(entry, position);
                        var point = GetPointAtSpan(entry, span);
                        var distanceSqr = (point - position).sqrMagnitude;
                        if (distanceSqr < bestDistanceSqr)
                        {
                            bestDistanceSqr = distanceSqr;
                            best = (entry, span);
                        }
                    }
                }
            }
            return best;
        }

        private static Vector3 GetPointAtSpan(TrackEntry entry, float span)
        {
            var points = entry.pointSet.points;
            var bestIdx = 0;
            var bestDiff = float.MaxValue;
            for (var i = 0; i < points.Length; i++)
            {
                var diff = Mathf.Abs((float)points[i].span - span);
                if (diff < bestDiff)
                {
                    bestDiff = diff;
                    bestIdx = i;
                }
            }
            return (Vector3)points[bestIdx].position;
        }

        private static Vector3 GetForwardAtSpan(TrackEntry entry, float span)
        {
            var points = entry.pointSet.points;
            var bestIdx = 0;
            var bestDiff = float.MaxValue;
            for (var i = 0; i < points.Length; i++)
            {
                var diff = Mathf.Abs((float)points[i].span - span);
                if (diff < bestDiff)
                {
                    bestDiff = diff;
                    bestIdx = i;
                }
            }
            return points[bestIdx].forward;
        }

        private static float FindSpanOnEntry(TrackEntry entry, Vector3 position)
        {
            var points = entry.pointSet.points;
            var bestIdx = 0;
            var bestDistSqr = float.MaxValue;
            for (var i = 0; i < points.Length; i++)
            {
                var distSqr = (((Vector3)points[i].position) - position).sqrMagnitude;
                if (distSqr < bestDistSqr)
                {
                    bestDistSqr = distSqr;
                    bestIdx = i;
                }
            }
            return (float)points[bestIdx].span;
        }

        private static string ComputeUpcomingJson()
        {
            var car = PlayerManager.Car;
            if (car == null || trackEntries == null || spatialIndex == null)
                return "[]";
            var carPosition = car.transform.position;

            TrackEntry startEntry;
            float startSpan;
            var forward = true;
            var bogie = car.FrontBogie ?? car.RearBogie;
            if (bogie != null
                && bogie.track != null
                && bogie.traveller != null
                && trackEntries.TryGetValue(bogie.track, out startEntry))
            {
                startSpan = Mathf.Clamp((float)bogie.traveller.Span, 0f, startEntry.length);
                forward = bogie.TrackDirectionSign > 0;
            }
            else
            {
                var closest = FindClosest(carPosition, LOCO_SEARCH_RADIUS_METERS, trackEntries, spatialIndex);
                if (closest == null)
                    return "[]";
                startEntry = closest.Value.entry;
                startSpan = closest.Value.span;
            }

            var candidates = new List<(float distance, WorldSign sign)>();
            var visited = new HashSet<TrackEntry>();
            var current = startEntry;
            var currentSpan = startSpan;
            var totalDistance = 0d;

            while (current != null && visited.Add(current))
            {
                if (signsByTrack!.TryGetValue(current, out var signList))
                {
                    foreach (var (signSpan, sign, appliesToForward) in signList)
                    {
                        if (appliesToForward != forward)
                            continue;
                        var offset = forward ? signSpan - currentSpan : currentSpan - signSpan;
                        if (offset >= 0)
                            candidates.Add(((float)(totalDistance + offset), sign));
                    }
                }
                if (candidates.Count >= MAX_SIGNS * 8)
                    break;

                var next = GetNextTrack(current, forward);
                if (next == null)
                    break;
                totalDistance += forward ? current.length - currentSpan : currentSpan;
                current = next;
                currentSpan = forward ? 0f : next.length;
                if (totalDistance > MAX_ROUTE_DISTANCE_METERS)
                    break;
            }

            var selected = candidates
                .OrderBy(c => c.distance)
                .Take(MAX_SIGNS)
                .Select(c => new JObject(
                    new JProperty("position", new World.Position(c.sign.position).ToLatLon().ToJson()),
                    new JProperty("speed", Math.Round(c.sign.speed))))
                .ToList();
            return JsonConvert.SerializeObject(selected);
        }

        private static TrackEntry? GetNextTrack(TrackEntry entry, bool forward)
        {
            var rt = entry.track;
            RailTrack? next = null;
            if (forward)
            {
                if (rt.outJunction != null)
                {
                    var junction = rt.outJunction;
                    if (junction.outBranches != null && junction.selectedBranch < junction.outBranches.Count)
                        next = junction.outBranches[junction.selectedBranch].track;
                }
                else
                {
                    next = rt.outBranch?.track;
                }
            }
            else
            {
                if (rt.inJunction != null)
                {
                    next = rt.inJunction.inBranch?.track;
                }
                else
                {
                    next = rt.inBranch?.track;
                }
            }
            if (next != null && trackEntries!.TryGetValue(next, out var nextEntry))
                return nextEntry;
            return null;
        }
    }
}