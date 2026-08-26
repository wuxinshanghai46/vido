#!/usr/bin/env python3

import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name("vido_disk_alert.py")
SPEC = importlib.util.spec_from_file_location("vido_disk_alert", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PlannedEventTests(unittest.TestCase):
    def test_crossing_threshold_alerts(self):
        self.assertEqual(MODULE.planned_event({}, 80, 80, 75, 86400, 100), "alert")

    def test_alert_is_deduplicated(self):
        previous = {"status": "alert", "last_alert_at": 90}
        self.assertIsNone(MODULE.planned_event(previous, 91, 80, 75, 86400, 100))

    def test_alert_repeats_after_interval(self):
        previous = {"status": "alert", "last_alert_at": 100}
        self.assertEqual(MODULE.planned_event(previous, 90, 80, 75, 86400, 86500), "alert")

    def test_hysteresis_prevents_flapping(self):
        previous = {"status": "alert", "last_alert_at": 100}
        self.assertIsNone(MODULE.planned_event(previous, 79, 80, 75, 86400, 200))
        self.assertEqual(MODULE.planned_event(previous, 75, 80, 75, 86400, 200), "recovery")


if __name__ == "__main__":
    unittest.main()
