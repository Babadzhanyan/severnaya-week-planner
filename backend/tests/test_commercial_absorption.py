"""Д10: поглощение прогноза заказом и заявкой, перенос между днями, повтор команды, чистая цена и подсказки."""
import unittest

from backend.commercial_offer import (CommercialError, action_hints, change_offer, commercial_view, economic_boundary, group_demand,
                                      move_volume, net_price, price_references, upsert_line)

GROUP = {"product": "fillet", "packing": "tray", "zone": "central", "client": "К-001"}
MONDAY, WEDNESDAY, NEXT_WEEK = "2026-03-02", "2026-03-04", "2026-03-09"


def command(command_id, row_class, volume_kg, day=MONDAY, price=300.0, **terms):
    return {"id": command_id, "product": "fillet", "packing": "tray", "day": day, "zone": "central", "client": "К-001",
            "rowClass": row_class, "volumeKg": volume_kg, "priceRubKg": price, **terms}


def lines_with(*commands):
    lines = {}
    for item in commands:
        upsert_line(lines, item)
    return lines


class AbsorptionTest(unittest.TestCase):
    def test_confirmed_order_absorbs_forecast_to_forecast_volume(self):
        lines = lines_with(command("f-1", "forecast", 10000), command("o-1", "confirmed_order", 6000, day=WEDNESDAY))
        result = group_demand(lines, GROUP)
        self.assertEqual(result["demandKg"], 10000)
        self.assertEqual(result["absorbedForecastKg"], 6000)
        self.assertEqual(result["incrementalKg"], 0)

    def test_moving_two_tonnes_between_days_keeps_weekly_sum(self):
        lines = lines_with(command("f-1", "forecast", 10000), command("o-1", "confirmed_order", 6000))
        before = group_demand(lines, GROUP)["demandKg"]
        self.assertTrue(move_volume(lines, "mv-1", "o-1", WEDNESDAY, 2000))
        self.assertEqual(lines["o-1"]["volumeKg"], 4000)
        self.assertEqual(lines["mv-1"]["day"], WEDNESDAY)
        self.assertEqual(group_demand(lines, GROUP)["demandKg"], before)
        self.assertEqual(sum(row["volumeKg"] for row in lines.values()), 10000 + 6000)

    def test_move_outside_the_week_is_rejected(self):
        lines = lines_with(command("f-1", "forecast", 10000))
        with self.assertRaises(CommercialError) as caught:
            move_volume(lines, "mv-1", "f-1", NEXT_WEEK, 2000)
        self.assertEqual(caught.exception.kind, "value_error")
        self.assertEqual(lines["f-1"]["volumeKg"], 10000)

    def test_repeated_command_creates_one_object(self):
        lines = {}
        self.assertTrue(upsert_line(lines, command("o-1", "confirmed_order", 6000)))
        self.assertFalse(upsert_line(lines, command("o-1", "confirmed_order", 6000)))
        self.assertEqual(len(lines), 1)
        with self.assertRaises(CommercialError) as caught:
            upsert_line(lines, command("o-1", "confirmed_order", 7000))
        self.assertEqual(caught.exception.kind, "command_conflict")
        self.assertEqual(lines["o-1"]["volumeKg"], 6000)

    def test_repeated_move_does_not_move_twice(self):
        lines = lines_with(command("f-1", "forecast", 10000))
        self.assertTrue(move_volume(lines, "mv-1", "f-1", WEDNESDAY, 2000))
        self.assertFalse(move_volume(lines, "mv-1", "f-1", WEDNESDAY, 2000))
        self.assertEqual(lines["f-1"]["volumeKg"], 8000)
        self.assertEqual(len(lines), 2)


class RequestTest(unittest.TestCase):
    def test_request_of_four_tonnes_absorbs_four_tonnes_with_zero_contribution(self):
        lines = lines_with(command("f-1", "forecast", 10000), command("r-1", "additional_request", 4000))
        result = group_demand(lines, GROUP, variable_cost_rub_kg=170)
        self.assertEqual(result["absorbedForecastKg"], 4000)
        self.assertEqual(result["incrementalKg"], 0)
        self.assertEqual(result["demandKg"], 10000)
        self.assertEqual(result["contributionDeltaRub"], 0)
        self.assertIn("поглощает 4 т прогноза", result["explanation"])
        self.assertIn("Прирост вклада нулевой", result["explanation"])

    def test_request_below_forecast_price_reduces_contribution_by_price_gap(self):
        lines = lines_with(command("f-1", "forecast", 10000), command("r-1", "additional_request", 4000, price=290.0))
        self.assertEqual(group_demand(lines, GROUP)["contributionDeltaRub"], -40000)

    def test_request_above_forecast_adds_only_surplus_volume(self):
        lines = lines_with(command("f-1", "forecast", 2000), command("r-1", "additional_request", 4000))
        result = group_demand(lines, GROUP, variable_cost_rub_kg=170)
        self.assertEqual(result["incrementalKg"], 2000)
        self.assertEqual(result["demandKg"], 4000)
        self.assertEqual(result["contributionDeltaRub"], 260000)

    def test_missing_variable_cost_leaves_delta_open_when_volume_grows(self):
        lines = lines_with(command("f-1", "forecast", 2000), command("r-1", "additional_request", 4000))
        self.assertIsNone(group_demand(lines, GROUP)["contributionDeltaRub"])


class NetPriceTest(unittest.TestCase):
    OFFER = {"priceRubKg": 300.0, "discountPct": 5, "bonusRubKg": 3, "logisticsRubKg": 10, "returnsPct": 1,
             "deferralDays": 0, "taxBasis": {"deductionRubKg": 0, "confirmedBy": "финансы"}}

    def test_net_price_chains_discount_bonus_logistics_and_returns(self):
        result = net_price(self.OFFER)
        self.assertAlmostEqual(result["netRubKg"], 269.15, places=9)
        self.assertTrue(result["complete"])
        self.assertEqual(result["components"][0]["key"], "price")

    def test_unconfirmed_tax_basis_keeps_net_price_open(self):
        result = net_price({**self.OFFER, "taxBasis": None})
        self.assertIsNone(result["netRubKg"])
        tax = next(item for item in result["components"] if item["key"] == "tax")
        self.assertEqual(tax["statusLabel"], "Требуется подтверждение")
        self.assertAlmostEqual(result["confirmedRubKg"], 300 - 15 - 2.85 - 3 - 10, places=9)

    def test_deferral_with_days_keeps_net_price_open(self):
        result = net_price({**self.OFFER, "deferralDays": 7})
        self.assertIsNone(result["netRubKg"])
        self.assertEqual(next(item for item in result["components"] if item["key"] == "deferral")["statusLabel"], "Требуется подтверждение")


class ReferenceTest(unittest.TestCase):
    def test_four_values_keep_distinct_labels_and_historical_maximum_stays_observation(self):
        values = price_references(historical_average_rub_kg=288.98, historical_max_rub_kg=390.4052, offer_price_rub_kg=300.0,
                                  boundary_rub_kg=economic_boundary(130, 10, 0, 30))
        self.assertEqual([item["label"] for item in values], ["Ориентир исторической сделки", "Действующее предложение",
                                                             "Рыночное наблюдение", "Экономическая граница уступки"])
        self.assertEqual(len({item["kind"] for item in values}), 4)
        maximum = next(item for item in values if item["key"] == "marketObservation")
        self.assertEqual(maximum["kind"], "Наблюдение")
        self.assertAlmostEqual(economic_boundary(130, 10, 0, 30), 200.0, places=9)
        self.assertIsNone(economic_boundary(130, 10, 0, 100))

    def test_missing_boundary_inputs_leave_boundary_open(self):
        values = price_references(historical_average_rub_kg=None, historical_max_rub_kg=None, offer_price_rub_kg=300.0,
                                  boundary_rub_kg=economic_boundary(None, 10, 0, 30))
        boundary = next(item for item in values if item["key"] == "economicBoundary")
        self.assertIsNone(boundary["rubKg"])
        self.assertEqual(boundary["status"], "Требуется подтверждение")


class LocalChangeTest(unittest.TestCase):
    def test_price_change_touches_only_its_own_line(self):
        lines = lines_with(command("f-1", "forecast", 10000), command("o-1", "confirmed_order", 6000, day=WEDNESDAY, price=310.0))
        before_other = dict(lines["o-1"])
        before_demand = group_demand(lines, GROUP)["demandKg"]
        self.assertTrue(change_offer(lines, "f-1", {"priceRubKg": 280.0}))
        self.assertEqual(lines["f-1"]["offerVersion"], 2)
        self.assertEqual(lines["f-1"]["volumeKg"], 10000)
        self.assertEqual(lines["o-1"], before_other)
        self.assertEqual(group_demand(lines, GROUP)["demandKg"], before_demand)

    def test_discount_on_one_line_leaves_other_line_net_price_unchanged(self):
        lines = lines_with(command("f-1", "forecast", 10000), command("o-1", "confirmed_order", 6000, day=WEDNESDAY))
        before = net_price(lines["o-1"])
        change_offer(lines, "f-1", {"discountPct": 10})
        discount = next(item for item in net_price(lines["f-1"])["components"] if item["key"] == "discount")
        self.assertAlmostEqual(discount["rubKg"], -30.0, places=9)
        self.assertEqual(net_price(lines["o-1"]), before)

    def test_unchanged_terms_do_not_bump_offer_version(self):
        lines = lines_with(command("f-1", "forecast", 10000))
        self.assertFalse(change_offer(lines, "f-1", {"priceRubKg": 300.0}))
        self.assertEqual(lines["f-1"]["offerVersion"], 1)


class HintTest(unittest.TestCase):
    def test_feasible_request_gets_no_hints(self):
        self.assertEqual(action_hints({"feasible": True, "levers": {"day": True}})["hints"], [])

    def test_only_levers_that_were_checked_become_hints(self):
        result = action_hints({"feasible": False, "levers": {"day": True, "discount": False, "basket": True}})
        self.assertEqual([hint["key"] for hint in result["hints"]], ["day", "basket"])

    def test_no_verified_lever_gives_no_invented_hint(self):
        result = action_hints({"feasible": False, "levers": {}})
        self.assertEqual(result["hints"], [])
        self.assertIn("Ни одно", result["reason"])


class ClientAliasTest(unittest.TestCase):
    def test_client_outside_alias_pattern_is_rejected(self):
        with self.assertRaises(CommercialError) as caught:
            upsert_line({}, {**command("o-1", "confirmed_order", 6000), "client": "Иван Петров"})
        self.assertEqual(caught.exception.body()["detail"][0]["type"], "client_alias_invalid")
        self.assertEqual(caught.exception.body()["detail"][0]["msg"], "Клиент указывается псевдонимом К-###")


class CommercialViewTest(unittest.TestCase):
    def test_commercial_view_keeps_change_and_threshold_open(self):
        result = commercial_view({"price": 210, "service": 10, "volume": 1, "share": 50})
        self.assertEqual(result["net"], 200)
        self.assertIsNone(result["change"])
        self.assertIsNone(result["threshold"])
        self.assertEqual(result["status"], "Требуется подтверждение")


if __name__ == "__main__":
    unittest.main()
