# Open Wi-Fi Cloudflare v1.0 - Fase 1.2
# RouterOS 7.16.1
#
# IMPORTANTE:
# 1) Substitua SOMENTE SEU_TOKEN_AQUI pela ROUTER_API_TOKEN nova.
# 2) O scheduler existente continua em 10s.
# 3) O script só remove bindings com comment="OpenWiFi Cloud".
# 4) Bindings manuais não são alterados.

:local apiUrl "https://openwifi-api.cauaholiveira06.workers.dev/api/router/poll"
:local siteId "openwifi-main"
:local token "SEU_TOKEN_AQUI"

:local hostsJson "["
:local first true

:foreach h in=[/ip hotspot host print as-value] do={

    :local mac ($h->"mac-address")
    :local originalIp ($h->"address")
    :local hotspotIp ($h->"to-address")

    :if ([:len $mac] > 0) do={

        :if ($first = false) do={
            :set hostsJson ($hostsJson . ",")
        }

        :set hostsJson ($hostsJson . \
            "{\"mac\":\"" . $mac . \
            "\",\"ip\":\"" . $hotspotIp . \
            "\",\"originalIp\":\"" . $originalIp . "\"}")

        :set first false
    }
}

:set hostsJson ($hostsJson . "]")

:local identity [/system identity get name]
:local board [/system resource get board-name]
:local version [/system resource get version]

:local payload ("{\"siteId\":\"" . $siteId . \
    "\",\"router\":{\"identity\":\"" . $identity . \
    "\",\"board\":\"" . $board . \
    "\",\"version\":\"" . $version . \
    "\"},\"hosts\":" . $hostsJson . "}")

:local result
:local fetchOk true

:onerror err in={

    :set result [/tool fetch \
        url=$apiUrl \
        http-method=post \
        http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json") \
        http-data=$payload \
        output=user \
        as-value]

} do={

    :set fetchOk false
    :log warning ("OpenWiFi Cloud fetch falhou: " . $err)
}

:if ($fetchOk = true) do={

    :local response
    :local jsonOk true

    :onerror err in={
        :set response [:deserialize value=($result->"data") from=json]
    } do={
        :set jsonOk false
        :log warning ("OpenWiFi Cloud JSON invalido: " . $err)
    }

    :if ($jsonOk = true) do={

        :local access ($response->"access")

        # ============================================================
        # REVOGACAO
        # Remove SOMENTE bindings criados pelo Open Wi-Fi Cloud.
        # Tambem derruba sessao HotSpot/cookie do mesmo MAC.
        # ============================================================

        :foreach bindingId in=[/ip hotspot ip-binding find where comment="OpenWiFi Cloud"] do={

            :local bindingMac [/ip hotspot ip-binding get $bindingId mac-address]
            :local bindingMacText [:tostr $bindingMac]
            :local keep false

            :foreach item in=$access do={

                :local allowedMac ($item->"mac")

                :if ($bindingMacText = $allowedMac) do={
                    :set keep true
                }
            }

            :if ($keep = false) do={

                # Derruba qualquer sessao autenticada do mesmo MAC.
                :foreach activeId in=[/ip hotspot active find where mac-address=$bindingMac] do={
                    /ip hotspot active remove $activeId
                }

                # Remove cookie HotSpot remanescente do mesmo MAC.
                :foreach cookieId in=[/ip hotspot cookie find where mac-address=$bindingMac] do={
                    /ip hotspot cookie remove $cookieId
                }

                /ip hotspot ip-binding remove $bindingId

                :log info ("OpenWiFi Cloud REVOGADO: " . $bindingMacText)
            }
        }

        # ============================================================
        # LIBERACAO
        # Cria bypass somente se nao existir qualquer binding no MAC.
        # Nunca sobrescreve binding manual.
        # ============================================================

        :foreach item in=$access do={

            :local allowedMac ($item->"mac")

            :local existing [/ip hotspot ip-binding find where mac-address=$allowedMac]

            :if ([:len $existing] = 0) do={

                /ip hotspot ip-binding add \
                    mac-address=$allowedMac \
                    server="openwifi-hotspot" \
                    type=bypassed \
                    comment="OpenWiFi Cloud"

                :log info ("OpenWiFi Cloud LIBERADO: " . $allowedMac)

            } else={

                :local cloudExisting [/ip hotspot ip-binding find \
                    where mac-address=$allowedMac and comment="OpenWiFi Cloud"]

                :if ([:len $cloudExisting] = 0) do={

                    # Binding manual: respeita e nao gera warning a cada 10 s.
                    # Deixamos silencioso para nao poluir o log.
                }
            }
        }
    }
}
