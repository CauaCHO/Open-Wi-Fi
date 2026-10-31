# Open Wi-Fi Cloudflare v1.0 - Fase 3A.3
# RouterOS 7.16.1
#
# IMPORTANTE:
# 1) Substitua SOMENTE SEU_TOKEN_AQUI pela ROUTER_API_TOKEN nova.
# 2) O scheduler existente continua em 10s.
# 3) O script só remove bindings com comment="OpenWiFi Cloud".
# 4) Bindings manuais não são alterados.
# 5) O binding Cloud copia address/to-address do HotSpot host.

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

            # Recupera a tradução real que o HotSpot está usando para esse MAC.
            # Isso é essencial quando address e to-address são diferentes.
            :local hostFound false
            :local originalIp ""
            :local hotspotIp ""

            :foreach hostId in=[/ip hotspot host find where mac-address=$allowedMac] do={
                :if ($hostFound = false) do={
                    :set originalIp [/ip hotspot host get $hostId address]
                    :set hotspotIp [/ip hotspot host get $hostId to-address]
                    :set hostFound true
                }
            }

            :local existing [/ip hotspot ip-binding find where mac-address=$allowedMac]
            :local cloudExisting [/ip hotspot ip-binding find \
                where mac-address=$allowedMac and comment="OpenWiFi Cloud"]

            :if ([:len $existing] = 0) do={

                :if (($hostFound = true) and ([:len $originalIp] > 0) and ([:len $hotspotIp] > 0)) do={

                    /ip hotspot ip-binding add \
                        mac-address=$allowedMac \
                        address=$originalIp \
                        to-address=$hotspotIp \
                        server="openwifi-hotspot" \
                        type=bypassed \
                        comment="OpenWiFi Cloud"

                } else={

                    /ip hotspot ip-binding add \
                        mac-address=$allowedMac \
                        server="openwifi-hotspot" \
                        type=bypassed \
                        comment="OpenWiFi Cloud"
                }

                :log info ("OpenWiFi Cloud LIBERADO: " . $allowedMac)

            } else={

                :if ([:len $cloudExisting] > 0) do={

                    # Se o cliente mudou IP/MAC-private mapping, mantém o binding
                    # Cloud alinhado ao host atual sem tocar em bindings manuais.
                    :if (($hostFound = true) and ([:len $originalIp] > 0) and ([:len $hotspotIp] > 0)) do={

                        :foreach cloudId in=$cloudExisting do={
                            /ip hotspot ip-binding set $cloudId \
                                address=$originalIp \
                                to-address=$hotspotIp
                        }
                    }

                } else={

                    # Existe binding manual para o MAC. Respeita e não sobrescreve.
                }
            }
        }
    }
}
